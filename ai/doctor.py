"""Check configured judges, then optionally warm them or send a synthetic prompt."""

import argparse
import asyncio
import json
import os
import sys

import httpx

from .config import MAX_TIMEOUT_SECONDS, load_judges
from .contracts import EvaluationRequest
from .diagnostics import inspect
from .panel import prepare_run, run_judge
from .scheduler import Probe, configured_seats


def probe_input() -> EvaluationRequest:
    return EvaluationRequest.model_validate({
        "conversation": {
            "key": "doctor", "group_id": "synthetic", "conversation_id": "doctor",
            "channel": "agent chat", "language": "EN", "audio_url": None,
            "turns": [
                {"id": "t1", "speaker": "client", "timestamp": "00:00", "text": "Hello."},
                {"id": "t2", "speaker": "operator", "timestamp": "00:01", "text": "Hello, this is Sam."},
            ],
        },
        "checklist": {
            "version_id": "doctor", "name": "Synthetic probe", "criteria": [{
                "id": "greeting", "label": "Greeting", "instruction": "Did the operator greet the client?",
                "kind": "binary", "weight": 1, "scale": [], "allow_na": False, "na_rule": None, "section": None,
            }],
        },
    })


def reachability(probe: Probe, *, hosted: bool = False) -> str:
    if hosted:
        return "configured (no health probe)"
    state = "reachable" if probe.reachable else "unreachable"
    return f"{state} ({probe.seconds * 1000:.0f} ms)"


def yes_no(value: bool | None) -> str:
    return "unknown" if value is None else "yes" if value else "no"


def hint(probe: Probe, provider: str) -> str | None:
    if probe.error == "connect" and provider == "ollama":
        return "Connection refused: run native Ollama, set OLLAMA_HOST=0.0.0.0:11434, and restart it."
    if probe.error == "connect":
        return "Connection refused: check the model server is running and listening on the LAN."
    if probe.error == "timeout":
        return "Timed out: check the firewall and whether Wi-Fi client isolation blocks laptop-to-laptop traffic."
    if probe.error == "response":
        return "Check the server URL and that its health endpoint responds successfully."
    return None


async def check(client: httpx.AsyncClient, *, probe: bool = False, warmup_url: str | None = None) -> int:
    try:
        config = load_judges()
        seats = configured_seats(config)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1

    rows = await inspect(client, seats, loaded=True)
    for row in rows:
        provider, fallback = row.seat.provider, row.seat.fallback
        # Quote the model server's version so an unexpected value cannot forge terminal output.
        version = json.dumps(row.primary.version) if row.primary.version else "-"
        spare = f"{fallback.host} {reachability(row.fallback)}" if fallback and row.fallback else "-"
        print(f"{row.seat.name}  {provider.host}  {reachability(row.primary, hosted=not provider.local)}"
              f"  version={version}  {provider.model} pulled={yes_no(row.pulled)}"
              f"  loaded={yes_no(row.loaded)}  fallback={spare}")
        for host, status in ((provider, row.primary), (fallback, row.fallback)):
            if host and status and (message := hint(status, host.name)):
                print(f"  {host.host}: {message}")
        for host, pulled in ((provider, row.pulled), (fallback, row.fallback_pulled)):
            if host and pulled is False:
                print(f"  {host.host}: run ollama pull {host.model} on that laptop.")

    usable = sum(row.usable for row in rows)
    warmup_failed = False
    if warmup_url:
        try:
            response = await client.post(f"{warmup_url.rstrip('/')}/warmup", timeout=config.panel.timeout_seconds + 5)
            response.raise_for_status()
            for row in response.json()["judges"]:
                print(f"warmup {row['name']}: {row['status']}")
                warmup_failed |= row["status"] == "failed"
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            print("Warmup endpoint failed. Start the evaluator and check its URL.", file=sys.stderr)
            warmup_failed = True

    if probe:
        run = await prepare_run(client, config, seats)
        data = probe_input()
        results = await asyncio.gather(*(run_judge(run, route, data) for route in run.routes))
        usable = sum(result.status == "ok" for result in results)
        for result in results:
            seconds = f"{result.seconds:.3f}s" if result.seconds is not None else "-"
            print(f"probe {result.name}: {result.status} {seconds} {result.error_code or ''}".rstrip())

    print(f"quorum: {usable}/{len(seats)} usable; {config.quorum} required")
    return int(usable < config.quorum or warmup_failed)


async def run(args) -> int:
    async with httpx.AsyncClient(timeout=httpx.Timeout(MAX_TIMEOUT_SECONDS, connect=3), trust_env=False) as client:
        return await check(client, probe=args.probe, warmup_url=args.evaluator_url if args.warmup else None)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", action="store_true", help="Grade a one-criterion synthetic transcript")
    parser.add_argument("--warmup", action="store_true", help="Ask the evaluator to load judge models")
    parser.add_argument("--evaluator-url", default=os.getenv("EVALUATOR_URL") or "http://127.0.0.1:8001")
    return asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
