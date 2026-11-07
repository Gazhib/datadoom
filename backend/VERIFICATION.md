# Backend acceptance status · 7 November 2026

## Agent 2 implementation update

Implemented the shared contract v1.1 backend additions: independent evaluator
timeouts (600 seconds default), process-wide bounded evaluator concurrency,
forward-compatible panel storage, migration 2 and durable evaluation jobs,
restart recovery, batch resume/cancel, latest summaries, judges proxy, bounded
NDJSON progress with legacy fallback, schema 1.0 results export/check/download,
and the API-based control run with import, resume, subset selection and export.

Verification in this checkout:

- Before changes: **94 tests passed**.
- First expanded suite: **155 tests passed** in 78.88 seconds.
- After completing the real-process control workflow and tightening stream event
  validation: **28 focused control/configuration/panel/stream tests passed** in
  17.88 seconds. The full suite was not repeated after these final changes.
- Ruff lint, format verification, strict mypy and whitespace checks passed.

The focused control test launches an actual local Uvicorn backend and invokes
the CLI as a subprocess. It exercises organizer import through the API, durable
jobs, a failed evaluation exported as an error row, resume, schema/count checks,
and subset selection. All inputs and evaluator responses are synthetic.

V-01 was retried and returned `configuration_unavailable`: no organizer URL is
configured. No official data, live model run, official results file or real
latency measurement was produced. See `HANDOFF.md` for the remaining external
acceptance gates and `README.md` for the control runbook.

Scope: T-003–T-005 and the backend portions of the public v1 contract in
`../requirements.md`. Frontend behavior, model inference, deployment and submission
remain with their assigned owners. Only files in `backend/` were changed.

## Implemented behavior and synthetic verification

| Requirement | Verified backend behavior | Evidence |
| --- | --- | --- |
| T-003 / FR-001 | Organizer envelope validation; atomic uploads; stable keys and turn IDs; exact order, timestamps and roles; RU/KZ/EN chat/call storage; identical reimport skip and conflict rollback | `tests/test_imports.py` |
| T-003 / FR-002 | Eight seeded criteria; editable immutable versions; stored evaluations retain their selected rubric after restart | `tests/test_checklists.py` |
| T-004 / FR-003 / NFR-002 | Complete conversation and saved checklist forwarded over HTTP; independent allowed-grade, rationale and evidence validation; failure creates no successful run and preserves earlier results | `tests/test_evaluations.py`, `tests/test_http_smoke.py` |
| V-05 backend boundary | Edited C05 sent for both the original and a fresh transcript; changed grade and evidence saved for the fresh key; earlier rubric and evaluation preserved | `tests/test_checklists.py` (HTTP evaluator stub, not real inference) |
| T-004 / FR-004 / V-02 | Original 77.69; correct section totals; N/A exclusion; all-N/A null total; independent serious-error flag; exact unrounded contributions and half-up display rounding | `tests/test_evaluations.py` |
| T-004 / FR-006 / V-06 | Confirmation and change; revised 84.62 alongside original 77.69; decisions survive restart; multiple changes accumulate; concurrent duplicate decisions conflict | `tests/test_appeals.py`, `tests/test_http_smoke.py` |
| T-005 / FR-007 / V-07 | Control runner continues after an upstream failure, resumes failed/pending records, skips only successful live results for the exact version, rejects fixtures and reports counts and timing | `tests/test_control.py` (simulated live responses) |
| NFR-001 / V-04 | Input errors omit source data; malformed service URLs return safe 503; invalid JSON encoding returns 422; signed organizer URL excluded from HTTP diagnostics; metadata-only organizer check never writes source data | `tests/test_api.py`, `tests/test_imports.py`, `tests/test_verification.py` |

## Checks

From the repository root:

```sh
uv run --project backend pytest backend/tests
uv run --project backend ruff check backend
uv run --project backend ruff format --check backend
uv run --project backend mypy --config-file backend/pyproject.toml backend
```

Observed on this revision: **94 tests passed** in 50.13 seconds. Ruff lint,
format verification and strict mypy checks also passed. The checks ran against
the existing backend environment using `uv run --project backend --no-sync`.

Tests use temporary databases and synthetic local HTTP services, including an
actual Uvicorn subprocess. The installed Python is 3.14.2 with FastAPI 0.162.0,
Pydantic 2.14.3 and HTTPX 0.28.1. Starlette emits a deprecation warning about its
HTTPX-based test client; it does not prevent the checks from running.

## External acceptance gates

- **V-01, official DEV:** `ORGANIZER_GET_URL` is absent from this environment and
  no local `.env` is present. The verifier currently exits 1 with
  `configuration_unavailable`. No official response, counts, speaker mapping,
  timestamp strings or recording access has been verified. Configure the authorized
  signed URL locally, run `python -m backend.verify --group-id DEV` as documented in
  the README, import DEV, and inspect one chat and call with the frontend owner.
- **V-05, real inference:** The backend passes the edited-rubric pair to a synthetic
  evaluator in tests. The same pair still needs the actual evaluator and browser
  flow with the AI and frontend owners.
- **V-07, official control:** At control release, verify and import the supplied
  group, run the CLI with the selected immutable version and retain its summary in
  ignored local storage. Record the group, version, processed/failed/skipped counts
  and elapsed time. Actual control processing has not been run.
- **NFR-003, representative latency:** Control summaries already report successful
  sample p95, throughput and backend retry count. Synthetic timings do not measure
  the 30-second DEV target or establish model quality. Measure with the team once
  authorized DEV access and live inference are available.

No official data, credentials or live-model results were added to the repository.
