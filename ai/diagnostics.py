"""Bounded preflight and model warmup shared by the API and CLI."""

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass

import httpx

from .config import JudgesConfig
from .providers import Provider, keep_alive_value
from .scheduler import PROBE_TIMEOUT, Probe, Seat, Slots, all_providers, probe_cache, resolve


@dataclass(frozen=True)
class Inspection:
    seat: Seat
    primary: Probe
    fallback: Probe | None
    pulled: bool | None
    loaded: bool | None
    fallback_pulled: bool | None

    def report(self) -> dict:
        return {
            "name": self.seat.name, "provider": self.seat.provider.name, "model": self.seat.provider.model,
            "host": self.seat.provider.host, "reachable": self.primary.reachable,
            "model_available": self.pulled,
            "fallback_host": self.seat.fallback.host if self.seat.fallback else None,
            "fallback_reachable": self.fallback.reachable if self.fallback else None,
        }

    @property
    def usable(self) -> bool:
        if self.primary.reachable:
            return self.pulled is not False
        return self.fallback is not None and self.fallback.reachable and self.fallback_pulled is not False


async def ollama_models(client: httpx.AsyncClient, provider: Provider, path: str) -> set[str] | None:
    try:
        async with asyncio.timeout(PROBE_TIMEOUT):
            response = await client.get(provider.local_endpoint(path), headers=provider.headers(), timeout=PROBE_TIMEOUT)
            response.raise_for_status()
            models = response.json()["models"]
            if not isinstance(models, list):
                return None
            return {
                name for row in models if isinstance(row, dict)
                if isinstance(name := row.get("name") or row.get("model"), str)
            }
    except (TimeoutError, httpx.HTTPError, KeyError, TypeError, ValueError):
        return None


def includes(models: set[str] | None, model: str) -> bool | None:
    if models is None:
        return None
    tag = model if ":" in model.rsplit("/", 1)[-1] else model + ":latest"
    return model in models or tag in models


async def inspect(client: httpx.AsyncClient, seats: Sequence[Seat], *, loaded: bool = False) -> list[Inspection]:
    providers = list(all_providers(seats))
    inventories: dict[tuple, asyncio.Task] = {}
    async with asyncio.TaskGroup() as group:
        probe_task = group.create_task(probe_cache.many(client, providers))
        for provider in providers:
            if provider.name != "ollama":
                continue
            for path in ("/api/tags", "/api/ps") if loaded else ("/api/tags",):
                key = provider.local_endpoint(path), provider.api_key
                if key not in inventories:
                    inventories[key] = group.create_task(ollama_models(client, provider, path))

    probes = probe_task.result()

    def available(provider: Provider | None, path: str) -> bool | None:
        if provider and probes[provider].reachable and provider.name == "ollama":
            return includes(inventories[provider.local_endpoint(path), provider.api_key].result(), provider.model)
        return None

    return [
        Inspection(seat, probes[seat.provider], probes[seat.fallback] if seat.fallback else None,
                   available(seat.provider, "/api/tags"), available(seat.provider, "/api/ps") if loaded else None,
                   available(seat.fallback, "/api/tags"))
        for seat in seats
    ]


async def warmup(client: httpx.AsyncClient, config: JudgesConfig, seats: Sequence[Seat]) -> dict:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + config.panel.timeout_seconds
    try:
        async with asyncio.timeout_at(deadline):
            probes = await probe_cache.many(client, all_providers(seats))
    except TimeoutError:
        return {"judges": [{"name": seat.name, "status": "failed", "error_code": "provider_timeout"} for seat in seats]}
    routes = [resolve(seat, probes) for seat in seats]
    slots = Slots(config.panel, routes)

    async def load(route):
        provider = route.provider
        row = {"name": route.name, "host": provider.host, "model": provider.model, "fallback": route.fallback}
        keep_alive = keep_alive_value(provider.keep_alive)
        if not route.probe.reachable:
            return dict(row, status="failed", error_code="provider_unavailable")
        try:
            async with slots.acquire(route.name, deadline):
                if provider.name != "ollama" or keep_alive in (0, "0s", "0ms", "0m", "0h"):
                    return dict(row, status="skipped", error_code=None)
                expires = min(deadline, loop.time() + config.panel.judge_timeout_seconds)
                async with asyncio.timeout_at(expires):
                    response = await client.post(
                        provider.local_endpoint("/api/generate"), headers=provider.headers(),
                        json={"model": provider.model, "keep_alive": keep_alive, "stream": False},
                    )
                    response.raise_for_status()
                    if response.json()["done"] is not True:
                        raise ValueError
        except (TimeoutError, httpx.TimeoutException):
            return dict(row, status="failed", error_code="provider_timeout")
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            return dict(row, status="failed", error_code="provider_error")
        return dict(row, status="ok", error_code=None)

    return {"judges": await asyncio.gather(*(load(route) for route in routes))}
