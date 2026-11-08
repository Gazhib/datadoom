# Backend · HANDOFF

Branch `agent/backend` · updated 2026-11-07 (Asia/Almaty).
Baseline commit `5611049`: 94 tests passed before implementation.

## Status

- B-F1: implemented — separate validated organizer/evaluator timeouts.
- B-F2: implemented — shared bounded evaluator semaphore, parallel HTTP regression tests.
- B-F3: implemented — typed, persisted panel, legacy payload support and mismatch dropping.
- B5 / V-01: blocked externally — `configuration_unavailable`; organizer URL absent.
- B1: implemented — schema 1.0 export, custom mapping, original/final selection,
  live-only selection, atomic writes, checker and download route.
- B2: implemented — migration 2, durable FIFO jobs, workers, recovery, cancellation,
  batch resume/deduplication, filtering and progress.
- B6: implemented — optional latest summaries, judges proxy, export attachment.
- B3: implemented — API queue control runner, resume, import, export, limits and runbook.
- B4: implemented — bounded NDJSON parsing, progress, terminal validation, 404/405 fallback.
- B7: deferred — optional live DEV run and analytics need external access/time.

## How to run and verify

From the repository root, using the existing environment:

```sh
UV_CACHE_DIR=/tmp/datadoom-uv-cache uv run --project backend --no-sync pytest backend/tests -q
UV_CACHE_DIR=/tmp/datadoom-uv-cache uv run --project backend --no-sync ruff check backend
UV_CACHE_DIR=/tmp/datadoom-uv-cache uv run --project backend --no-sync ruff format --check backend
UV_CACHE_DIR=/tmp/datadoom-uv-cache uv run --project backend --no-sync mypy --config-file backend/pyproject.toml backend
```

Tests start localhost HTTP servers and need permission to bind ports. See
README's frozen **Control run in one hour** heading for the organizer workflow.
The first expanded suite passed 155 tests; the final focused control/panel/stream
run passed 28 tests. Ruff lint/format, strict mypy and whitespace checks passed.
No further tests were added or run after the user's request to reduce testing.

## V-01 aggregates

No official data was available. The verifier returned only:

```json
{"event":"error","code":"configuration_unavailable","message":"Organizer import is not configured."}
```

Official aggregate counts and throwaway-database list/detail verification remain
pending the authorized organizer URL. No transcripts or URLs were printed.

## Decisions

- Work is in the user's clean macOS checkout on its dedicated `agent/backend`
  branch; the handoff's WSL paths do not exist here. No peer agents were started.
- Implementation remains local and uncommitted for review; no remote push was made.
- SQLite remains the durable queue; no external broker or new dependency was added.
- Run exactly one API process per database; concurrency is process-wide, not distributed.
- Batch resume reuses active jobs as well as skipping existing successful live runs.
- Streaming uses the existing evaluator response cap (2 MB total) as well as 2 MB/line.
- Terminal evaluator stream errors preserve their status/code with a safe generic message.
- All-error exports use `local/unavailable` because no evaluated model was selected.
- Limits select evaluation work; organizer exports always contain the whole group.
- With export requested, a passing schema/count check yields exit 0, including valid
  error rows. Operators must inspect the error count; no failed dialogue becomes zero.

## Contract change requests

None.

## Root-file changes

None. All implementation and documentation changes are within `backend/`.

## Notes for the humans

The organizers require validated `results/dev/results.json` and
`results/prod/results.json` in the public repository. This overrides NFR-001 for
`results/**` only. Humans commit/push the data after `backend.export --check` passes.
No official result files were generated without official input or live evaluation.

Suggested requirements status update: backend implements long evaluations, durable
jobs, panel storage, streaming progress, organizer exports, and the API-based control
runner. V-01, real inference quality, representative latency and official control
execution remain external acceptance gates.

## Known issues and next steps

Supply authorized organizer configuration, verify DEV aggregates, rehearse with the
real evaluator preset, then generate and validate the official result files.
Do not run a standalone control process alongside API evaluation.
