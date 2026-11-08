"""Resolve local judge routes and enforce ordered admission within a panel run."""

import asyncio
from collections import Counter, OrderedDict
from collections.abc import Iterable
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field
from hashlib import sha256
from time import monotonic

import httpx

from .config import JudgesConfig, PanelConfig, load_judges
from .errors import EvaluationError
from .providers import Provider, build_provider


PROBE_TIMEOUT = 1.5
PROBE_TTL = 30
MIN_START_SECONDS = 15


@dataclass(frozen=True)
class Seat:
    name: str
    provider: Provider
    fallback: Provider | None = None


@dataclass(frozen=True)
class Probe:
    reachable: bool
    seconds: float = 0
    version: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class Route:
    name: str
    provider: Provider
    probe: Probe
    fallback: bool = False


class ProbeCache:
    def __init__(self):
        self._entries: OrderedDict[tuple, tuple[float, Probe]] = OrderedDict()

    def clear(self) -> None:
        self._entries.clear()

    async def get(self, client: httpx.AsyncClient, provider: Provider) -> Probe:
        if not provider.local:
            # Hosted services have no health endpoint used by the evaluator.
            return Probe(True)
        path = "/api/version" if provider.name == "ollama" else "/health"
        endpoint = provider.local_endpoint(path)
        key = provider.name, endpoint, sha256(provider.api_key.encode()).digest()
        now = monotonic()
        entry = self._entries.get(key)
        if entry and entry[0] > now:
            return entry[1]

        error = None
        version = None
        try:
            async with asyncio.timeout(PROBE_TIMEOUT):
                response = await client.get(endpoint, headers=provider.headers(), timeout=PROBE_TIMEOUT)
                response.raise_for_status()
                if provider.name == "ollama":
                    body = response.json()
                    version = body.get("version") if isinstance(body, dict) else None
                    if not isinstance(version, str) or not version:
                        error = "response"
        except (TimeoutError, httpx.TimeoutException):
            error = "timeout"
        except httpx.ConnectError:
            error = "connect"
        except (httpx.HTTPError, ValueError):
            error = "response"
        result = Probe(error is None, monotonic() - now, version if error is None else None, error)
        self._entries[key] = (monotonic() + PROBE_TTL, result)
        self._entries.move_to_end(key)
        if len(self._entries) > 256:
            self._entries.popitem(last=False)
        return result

    async def many(self, client: httpx.AsyncClient, providers: Iterable[Provider]) -> dict[Provider, Probe]:
        unique = list(dict.fromkeys(providers))
        # Different models on one server share a probe (including concurrent cold-cache lookups).
        groups: dict[tuple, list[Provider]] = {}
        for provider in unique:
            key = provider.name, provider.local_endpoint("") if provider.local else provider.host, provider.api_key
            groups.setdefault(key, []).append(provider)
        probes = await asyncio.gather(*(self.get(client, group[0]) for group in groups.values()))
        return {provider: result for group, result in zip(groups.values(), probes, strict=True) for provider in group}


probe_cache = ProbeCache()


def configured_seats(config: JudgesConfig) -> list[Seat]:
    seats = []
    for judge in config.judges:
        try:
            primary = build_provider(judge, keep_alive=config.panel.keep_alive)
            fallback = None
            if judge.fallback_url:
                fallback = build_provider(
                    judge.model_copy(update={"url": judge.fallback_url, "model": judge.fallback_model or primary.model}),
                    keep_alive=config.panel.keep_alive,
                )
            seats.append(Seat(judge.name, primary, fallback))
        except ValueError as error:
            raise ValueError(f"Judge {judge.name}: {error}") from None
    return seats


def load_panel() -> tuple[JudgesConfig, list[Seat]]:
    try:
        # Read per request so edits to judges.yaml apply to the next evaluation.
        config = load_judges()
        return config, configured_seats(config)
    except ValueError as error:
        raise EvaluationError(503, "provider_unavailable", str(error)) from None


def all_providers(seats: Iterable[Seat]) -> Iterable[Provider]:
    for seat in seats:
        yield seat.provider
        if seat.fallback:
            yield seat.fallback


def resolve(seat: Seat, probes: dict[Provider, Probe]) -> Route:
    primary = probes[seat.provider]
    if not primary.reachable and seat.fallback and probes[seat.fallback].reachable:
        return Route(seat.name, seat.fallback, probes[seat.fallback], fallback=True)
    return Route(seat.name, seat.provider, primary)


@dataclass
class HostPool:
    active: int = 0
    reservations: int = 0
    released: asyncio.Event = field(default_factory=asyncio.Event)


# Share local host capacity between simultaneous evaluations and warmups in this process.
host_pools: dict[tuple[asyncio.AbstractEventLoop, str], HostPool] = {}


@asynccontextmanager
async def host_slot(host: str, limit: int):
    key = asyncio.get_running_loop(), host
    pool = host_pools.setdefault(key, HostPool())
    pool.reservations += 1
    acquired = False
    try:
        while pool.active >= limit:
            await pool.released.wait()
        pool.active += 1
        acquired = True
        yield
    finally:
        if acquired:
            pool.active -= 1
            pool.released.set()
            pool.released = asyncio.Event()
        pool.reservations -= 1
        if not pool.reservations:
            del host_pools[key]


@dataclass
class Gate:
    semaphore: asyncio.Semaphore | None
    previous: asyncio.Event
    admitted: asyncio.Event
    host: str | None
    limit: int


class Slots:
    def __init__(self, config: PanelConfig, routes: Iterable[Route]):
        routes = list(routes)
        hosts = Counter(route.provider.host for route in routes if route.provider.local and route.probe.reachable)
        self.shared_hosts = {host for host, count in hosts.items() if count > 1}
        self.gates: dict[str, Gate] = {}
        groups: dict[str, Gate] = {}
        for route in routes:
            if not route.probe.reachable:
                continue
            host = route.provider.host if route.provider.local else None
            if config.execution == "sequential":
                group, limit = "*", 1
                semaphore = groups[group].semaphore if group in groups else asyncio.Semaphore(1)
            elif config.execution == "auto" and host:
                group, limit = host, config.host_concurrency
                semaphore = None
            else:
                continue
            previous = groups[group].admitted if group in groups else asyncio.Event()
            if group not in groups:
                previous.set()
            groups[group] = self.gates[route.name] = Gate(semaphore, previous, asyncio.Event(), host, limit)

    @asynccontextmanager
    async def acquire(self, name: str, cutoff: float):
        gate = self.gates.get(name)
        if not gate:
            yield
            return
        try:
            async with AsyncExitStack() as held:
                async with asyncio.timeout_at(cutoff):
                    await gate.previous.wait()
                    if gate.semaphore:
                        await gate.semaphore.acquire()
                        held.callback(gate.semaphore.release)
                    if gate.host:
                        await held.enter_async_context(host_slot(gate.host, gate.limit))
                    gate.admitted.set()
                yield
        finally:
            gate.admitted.set()
