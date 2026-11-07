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
The AI evaluator must serve `POST /evaluate`, normally on port 8001.
The backend sends the complete selected checklist and conversation on every run.

| Variable | Default / purpose |
| --- | --- |
| `DATABASE_PATH` | Absolute `backend/storage/datadoom.sqlite3` path derived from the code location |
| `EVALUATOR_URL` | `http://127.0.0.1:8001`, without `/evaluate` |
| `ORGANIZER_GET_URL` | Unset; complete signed organizer GET URL, configured locally |
| `UPSTREAM_TIMEOUT_SECONDS` | 60; organizer HTTP timeout only, greater than 0 and at most 60 seconds |
| `EVALUATOR_TIMEOUT_SECONDS` | 600; evaluator HTTP timeout, greater than 0 and at most 900 seconds |
| `EVALUATION_CONCURRENCY` | 1; integer 1–8, evaluator calls in flight per backend process |
| `EVALUATOR_STREAM` | `false`; enable NDJSON job progress, falling back on evaluator 404/405 |
| `RESULTS_TEAM_NAME` | Unset; default team name for result exports |
| `BACKEND_ALLOW_FIXTURE` | `false`; set `true` only for explicit synthetic rehearsal |
| `FRONTEND_DIST` | Repository `frontend/dist`; served at `/` when that build exists at API startup |

SQLite is created and migrated at startup; `default-v1` is seeded once. Database
connections and transactions are local to each operation. No Redis, PostgreSQL or
external queue service is needed. In-process workers use the durable SQLite queue.
Run one backend process (one Uvicorn worker) per database: recovery and evaluation
capacity are process-local. Keep the server on localhost for this unauthenticated
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

### Verify organizer access

Set `ORGANIZER_GET_URL` in the ignored `backend/.env`, then run:

```sh
uv run --project backend --env-file backend/.env python -m backend.verify --group-id DEV
```

The command fetches and validates the organizer wrapper and every record through
the same ingestion boundary as the API. It prints one JSON report with counts by
channel, language and speaker; timestamp-format counts; unique-conversation count;
and call recording-link coverage. It does not print transcripts, conversation IDs,
timestamps or URLs, and does not create or write a database. Timestamp strings are
only classified for this report; imports preserve the originals exactly.

DEV reports check the documented counts. Other groups use their actual counts,
including an empty successful group. Missing call recording links or duplicate
conversation IDs fail verification. An unfamiliar timestamp format is reported as
`other` for inspection, without rejecting otherwise valid source timestamps.
Exit status is 0 when the checks pass and 1 for a mismatch, missing configuration
or upstream failure. A present HTTP(S) recording link does not establish that the
recording is reachable; the command does not fetch recordings.

Run with `--group-id CONTROL` when control access is released, then import and
process that group using the commands below. Keep actual verification and run
reports in ignored local storage. [Verification status](VERIFICATION.md) separates
synthetic test evidence from the remaining official-data acceptance checks.

## Synthetic rehearsal with an evaluator stub

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

The standalone CLI always disables fixture acceptance, even if `BACKEND_ALLOW_FIXTURE=true`.
API control runs also reject fixture results as successful control evaluations.
Run one control process per group/version; concurrent invocations are not a
distributed job system. JSON-line output contains operational metadata: successes,
failures, skipped counts, wall time, successful-sample nearest-rank p95 latency,
throughput and backend retry count (zero; resume is the retry mechanism).
Without `--export`, exit status is 1 if any attempt fails or configuration is
unavailable, and 0 otherwise. With `--export`, exit 0 means the written document
passes the schema and optional count checks; it can still contain error rows.
Read the printed error count. Retain the summary locally to estimate processing time.
Synthetic timings do not establish the representative DEV p95 target of 30 seconds.

## Control run in one hour

Configure the backend's organizer URL locally, select the saved checklist version,
and keep the API/evaluator running. Replace the angle-bracket placeholders:

```sh
python -m backend.verify --group-id <PROD_GROUP>
python -m backend.cli --group-id <PROD_GROUP> --checklist-version-id <VERSION> --import-organizer \
  --via-api http://127.0.0.1:8000 --export results/prod/results.json --team-name "<TEAM>" --expect-count 10
# Docker: docker compose exec backend python -m backend.cli …
python -m backend.export --check results/prod/results.json --expect-count 10
```

Use the environment's Python (for example prefix commands with `uv run --project
backend --env-file backend/.env`). The Docker deployment must mount `./results`
at `/app/results` for the file to appear on the host.

The API runner imports through `/api/imports`, enqueues a batch with
`skip_existing=true`, polls every two seconds and emits JSON progress lines.
Repeat the same command to resume. Successful live evaluations for the exact
version are skipped, existing active jobs are reused, and failed jobs can run
again. `--limit N` and `--only id,id` restrict evaluations in import order; exports
still include every conversation in the group, with error rows for missing runs.

Do not run the standalone CLI without `--via-api` while the API is evaluating:
separate processes have separate semaphores and can double-load every judge laptop.
Review the summary, check both DEV (expected 65) and PROD (expected 10) files, and
have the humans commit and push the validated files before code freeze. This
organizer requirement permits `results/**/results.json` in the public repository;
source transcripts, recordings, credentials and databases stay private.

## Evaluation jobs and progress

`POST /api/evaluation-jobs` accepts `{conversation_key, checklist_version_id}` and
returns 202 immediately. `GET /api/evaluation-jobs/{id}` reads a job, and
`GET /api/evaluation-jobs?conversation_key=…&active=true` lists queued/running jobs
newest first. Queued positions start at 1. `POST /api/evaluation-jobs/batch` accepts
`{group_id, checklist_version_id, skip_existing: true}`. Missing conversations and
checklists return 404. `POST /api/evaluation-jobs/{id}/cancel` cancels queued work;
other states return 409 `job_not_cancellable`.

Workers claim jobs in creation order in short write transactions, release the
database during evaluation, then save the outcome. Restart marks running jobs
failed with `interrupted` and retains queued work. Shutdown stops new claims and
waits up to five seconds for workers; a daemon worker draining an in-flight call
owns its HTTP client. Forced process exit leaves the job recoverable on restart.
Tests can use `create_app(settings, start_workers=False)` and `Jobs.run_one()`.

Synchronous evaluation and queue workers share one bounded semaphore around only
the evaluator call. The organizer timeout remains independent. Streaming enforces
2 MB per line and a 2 MB total cap, requires exactly one terminal result/error,
and remembers 404/405 fallback for the process. Invalid streams return 502
`invalid_evaluator_response`. Panels are typed, tolerate unknown nested fields,
and persist with the evaluation; a panel with mismatched criterion IDs is dropped
with a metadata-only warning. Existing payloads without panels remain readable.

`GET /api/conversations?include=latest` adds the newest evaluation's summary,
including its current final total. `GET /api/judges` uses a three-second evaluator
request and returns 503 `evaluator_unavailable` if unavailable.

## Organizer results export

```sh
python -m backend.export --group-id DEV --checklist-version-id default-v1 \
  --out results/dev/results.json --team-name "<TEAM>" --expect-count 65
python -m backend.export --check results/dev/results.json --expect-count 65
```

Exports select the newest successful **live** evaluation for each conversation
and exact checklist version in import order. Fixture evaluations are excluded.
Default scores and grades are original; `--use-final` includes appeal corrections.
Missing live runs become error rows with a null score. The file contains grades,
rationales and evidence positions, without transcript fields or recording links.
Rationales are evaluator output and must follow the agreed no-transcript policy.

Only this exporter knows the C01–C08 code mapping. Other checklist IDs require
`--criterion-map FILE`, a JSON object such as `{"custom-contact":"contact"}`;
the resulting map must cover each of the eight organizer codes exactly once.
Unmapped IDs produce `unmapped_criteria`. Model names and local/external/hybrid
mode are aggregated across all selected runs, using panel judges when present.
If every row is an error, no model was used: the metadata is `local/unavailable`.

`--check` verifies UTF-8 JSON, schema version, names, unique IDs, exactly eight
valid criterion values for each successful row, nonblank rationales, positive
integer evidence positions, scores from 0–100 with at most two decimals, and
matching critical flags. Error rows require empty criteria, null scores and an
error message. The exporter checks before writing and again on the temporary
file, then atomically replaces the destination. It prints one JSON count summary.

`GET /api/exports/results?group_id=…&checklist_version_id=…&team_name=…&use_final=false`
downloads the same document as an application/json attachment. For custom maps,
use the standalone export command. The route returns 422 for unmapped criteria.

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
  inputs. Invalid JSON encoding returns 422; malformed service URLs return 503
  without disclosing their values. API responses are marked `Cache-Control: no-store`.
- HTTPX INFO and HTTPCore DEBUG diagnostics are disabled at API startup and by the
  organizer verifier to keep signed organizer URLs out of operational logs.
- Runtime configuration, databases, logs, environments and caches are ignored by
  `backend/.gitignore`. Default database storage is private locally. Keep any
  custom database path in an ignored directory. Do not commit official transcripts,
  recordings or signed URLs. The organizer-mandated, validated `results/**/results.json`
  files are the sole exception for derived official data; humans publish them.

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
localhost ports. AI provider verification and frontend interaction remain their
respective owners' tasks.
