# Datadoom backend

Implements T-003–T-005 and the v1 public contract in `../requirements.md` using
FastAPI, Pydantic, HTTPX and SQLite. All backend source, dependencies, tests and
synthetic fixtures are contained in this directory. Python 3.11+ and `uv` are required.
Run the commands below from the **repository root**.

## Setup and launch

```sh
uv sync --project backend --locked
cp backend/.env.example backend/.env
uv run --project backend --env-file backend/.env uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The backend listens at `http://127.0.0.1:8000`. Interactive API docs are at `/docs`;
`GET /api/health` returns `{"status":"ok"}` even if the evaluator is unavailable.
The ML teammate's evaluator must serve `POST /evaluate`, normally on port 8001.
The backend sends the complete selected checklist and conversation on every run.

| Variable | Default / purpose |
| --- | --- |
| `DATABASE_PATH` | Absolute `backend/storage/datadoom.sqlite3` path derived from the code location |
| `EVALUATOR_URL` | `http://127.0.0.1:8001`, without `/evaluate` |
| `ORGANIZER_GET_URL` | Unset; complete signed organizer GET URL, configured locally |
| `UPSTREAM_TIMEOUT_SECONDS` | 60; positive HTTP timeout, at most 60 seconds |
| `BACKEND_ALLOW_FIXTURE` | `false`; set `true` only for explicit synthetic rehearsal |
| `FRONTEND_DIST` | Repository `frontend/dist`; served at `/` when that build exists at API startup |

SQLite is created and migrated at startup; `default-v1` is seeded once. Database
connections and transactions are local to each operation. No Redis, PostgreSQL or
background worker is needed. Keep the server on localhost for this unauthenticated
demo, as specified in the requirements.

When the frontend teammate supplies `frontend/dist`, restart the API to serve the
built application. During Vite development, the frontend should proxy relative
`/api` requests to port 8000. No frontend files are changed by this backend handoff.

## Importing data

`POST /api/imports` accepts either:

```json
{"source":"organizer","group_id":"DEV"}
```

or `{"source":"upload","group_id":"UPLOAD","records":[...]}` using the raw
record contract. Uploads accept a raw **array** in `records`; converting single
records and organizer envelopes is the frontend's responsibility. JSON request
bodies and organizer responses are limited to 25 MB.

Organizer import changes only the configured URL's `group_id` query parameter,
preserving the encoded signed parameters and their order. It reads
`data.records` only when `isSuccess` is the boolean `true`. An empty successful
group imports zero records. HTTP redirects are rejected rather than followed.
The audio URL is preserved as an HTTP(S) link and is never fetched by the backend.

All records validate before a transaction writes anything. Identical records
are skipped, including repeated records within one upload. A changed record for
an existing `(group_id, conversation_id)` returns 409 and rolls back the whole
batch. Public keys are stable generated IDs, timestamps and transcript order are
preserved, and turns receive `t1`, `t2`, etc. Blank chat audio links become null.

Organizer DEV access was **not verified** in this handoff: no signed URL was
provided in backend configuration. When available, the expected DEV target is
65 records (60 chats / 5 calls; 35 RU / 15 KZ / 15 EN). Check the actual response
for control-group size; do not assume DEV counts apply to control data.

## Synthetic rehearsal without ML

This is a canned evaluator for the supplied synthetic fixture, not inference.
It returns `mode: "fixture"` and `fixture / synthetic-v1` model metadata. It is
never started by the backend automatically.

In one terminal:

```sh
uv run --project backend python -m backend.tests.http_stub
```

In another, explicitly opt the backend into synthetic output:

```sh
BACKEND_ALLOW_FIXTURE=true uv run --project backend uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Import the synthetic transcript, then use `/docs` to select its returned key and
evaluate it with `default-v1`:

```sh
uv run --project backend python -c 'import json,httpx; records=json.load(open("backend/fixtures/synthetic.json")); print(httpx.post("http://127.0.0.1:8000/api/imports",json={"source":"upload","group_id":"SYNTH","records":records}).json())'
```

The original total is 77.69. Open a C06 appeal and resolve it with:

```json
{
  "action": "change",
  "reason": "Consultation completeness is graded separately from dialogue clarity.",
  "replacement": {
    "criterion_id": "C06",
    "value": 10,
    "reason": "The operator's wording and sequence are clear.",
    "evidence_turn_ids": ["t2", "t3"]
  }
}
```

The final becomes 84.62 and the original remains 77.69 after restart. A separate
run can demonstrate confirmation without changing the grade. The canned stub
only supplies default-rubric grades; use the real evaluator for changed criteria.

## Control-run command

Import the group using the API first, then select an immutable saved version:

```sh
uv run --project backend --env-file backend/.env python -m backend.cli --group-id CONTROL --checklist-version-id default-v1
```

Add `--import-organizer` to import from the locally configured organizer URL first.
The command uses the same validation, evaluator HTTP call, scoring and persistence
as the API. It processes sequentially and continues after upstream failures.
Repeat the same command to resume: successful **live** evaluations for that
conversation and exact checklist version are skipped; failed/pending conversations
and fixture-only results are processed again. A deliberate API rerun always
creates a new evaluation.

The CLI always disables fixture acceptance, even if `BACKEND_ALLOW_FIXTURE=true`.
Run one control process per group/version; concurrent invocations are not a
distributed job system. JSON-line output contains operational metadata: successes,
failures, skipped counts, wall time, successful-sample nearest-rank p95 latency,
throughput and backend retry count (zero; resume is the retry mechanism).
Exit status is 1 if any attempt fails or configuration is unavailable, and 0
otherwise. Retain the summary locally to estimate the real control processing time.
Synthetic timings do not establish the representative DEV p95 target of 30 seconds.

## Persistence and validation

- Checklist POST creates an immutable version. Each run freezes its full checklist.
- Evaluator grades require exactly one result per criterion, valid grade values,
  nonblank reasons, and real evidence turn IDs. Bad output and timeouts create no run.
- Scoring uses exact unrounded rational contributions and decimal half-up rounding
  to two places. N/A rows and flags have null points; serious-error flags do not
  modify totals. Section ordering follows the frozen rubric.
- One appeal is allowed per run/criterion. Decisions acquire a SQLite write
  transaction, require an open appeal, overlay all resolved grade changes on the
  original, and atomically save the decision and recomputed final. Concurrent
  duplicate decisions return 409. Confirmation preserves the original grade.
- All API errors use `{error: {code, message}}`; validation does not echo source
  inputs. API responses are marked `Cache-Control: no-store`.
- Runtime configuration, databases, logs, environments and caches are ignored by
  `backend/.gitignore`. Default database storage is private locally. Keep any
  custom database path in an ignored directory. Do not commit official transcripts,
  recordings, signed URLs or real results. Only synthetic fixtures are checked in.

## Verification

```sh
uv run --project backend pytest backend/tests
uv run --project backend ruff check backend
uv run --project backend ruff format --check backend
uv run --project backend mypy --config-file backend/pyproject.toml backend
```

Tests use temporary SQLite databases and a real local HTTP organizer/evaluator stub,
with an additional Uvicorn process smoke test. They cover V-02, V-04, V-06 and V-07,
including upload rollback, concurrency, saved checklist snapshots, exact fixture
totals, arbitrary IDs, invalid grades/evidence, unavailable configuration, upstream
outages/timeouts, decision history, and subprocess control-run resume. The live-mode
responses in control tests are simulated using synthetic data; they do not count
as real model inference or organizer access. The tests need permission to bind
localhost ports. ML provider verification and frontend interaction remain their
respective owners' tasks.
