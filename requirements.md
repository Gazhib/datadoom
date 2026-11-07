# Datadoom · Conversation Quality Analytics

Build an AI-powered hackathon prototype for a QA analyst and a reviewer. The analyst imports a dialogue, selects a saved checklist, runs an AI evaluation and can jump from each grade to its evidence. The reviewer resolves an appeal with a reason and can inspect the original and final scores. A judge can replace a criterion in the UI and apply the saved version to a previously unseen dialogue.

## Implementation status · 7 November 2026

Both Docker stacks served the website and returned the seeded `default-v1` checklist through the API. Live inference is the main blocker. A synthetic request reached the evaluator, which returned `503 provider_unavailable` because it could not reach the configured llama.cpp server.

| Owner and task | Finished | Still open |
| --- | --- | --- |
| AI · T-001 | Evaluator endpoint, provider integration and contract tests. An earlier local model run graded a one-criterion synthetic input. | Restore model access from Docker and confirm a full-checklist request succeeds. The previous full-checklist run timed out. |
| AI · T-002 | Rubric-driven prompt, grade and evidence validation, and tests for invalid output and provider failures. | Run V-03 on fresh RU, KZ and EN transcripts, including the required edge cases. Run the edited C05 pair with frontend and backend (V-05). Measure representative DEV p95 against the 30-second target (NFR-003) and record per-evaluation cost if using a paid model (CON-006). |
| Backend · T-003 | JSON and organizer import paths, stable IDs, SQLite persistence and immutable checklist versions. Synthetic import and persistence tests passed. | Configure the organizer URL with authorized access. Verify the DEV response, counts, speaker roles, timestamps and recording URLs (V-01). |
| Backend · T-004 | Scoring, evaluation validation and appeal persistence passed synthetic tests, including the 77.69 original and 84.62 revised totals (V-02, backend portions of V-04 and V-06). | — |
| Backend · T-005 | Control CLI and resume behavior verified with synthetic data, including skipping successful live runs for the same checklist version. | Run the official control group with the team lead when released. Record the checklist version, processed count, failures and timing (V-07). |
| Frontend · T-006 | Import, conversation list, transcript, evaluation results, evidence links and recording links are implemented. Frontend lint and production build passed. | Rehearse the browser flow with an official chat and call. Check evidence navigation, recording access and failure states (V-01 and V-04). |
| Frontend · T-007 | Checklist editing and version selection, appeal submission and resolution, and original/final score display are implemented. | Save the replacement C05 in the browser and verify the live results with AI and backend (V-05). Rehearse appeal confirmation, grade change and reload in the browser (V-06). |
| Team lead · T-008 | Role branches are merged and the integrated Docker stack runs locally. The root quick-start and Docker files exist in the working tree. | Include the quick-start and Docker files in the submission commit, verify launch from a clean clone, check the submitted contents for secrets and official data, send the repository link, record the H+24 commit and rehearse the five-minute defense (V-08). |

**Optional FR-008** remains open. Run history lets users switch between evaluations. Comparing two checklist versions side by side would require a separate view.

All 11 AI contract tests passed with synthetic fixtures. The backend suite passed 78 tests on Windows in UTF-8 mode. Two localhost timeout cases passed when rerun in Linux Docker.

## Start here · three independent handoffs

Give each agent this file and the same initial repository snapshot. Each works on its own branch or clone, uses the contract and synthetic fixture below, and delivers one mergeable branch. The team lead resolves contract changes in this file and distributes the revision to all three agents.

| Send to | Paste into that agent's session | Standalone run |
| --- | --- | --- |
| AI Engineer | Implement **T-001–T-002** in `ai/`. Integrate one LLM provider, build the prompt from the active checklist, validate structured grades and evidence, and deliver a small evaluation suite and launch notes. | Serve on `127.0.0.1:8001`. POST `{conversation, checklist}` with the synthetic fixture directly to `/evaluate`. |
| Backend agent | Implement **T-003–T-005** in `backend/`. Use the public and evaluator contracts in `requirements.md`. Deliver persistence, ingestion, scoring, appeals and the control-run command. Use a local evaluator stub for your tests. | Serve on `127.0.0.1:8000`. Run API checks against your own HTTP evaluator stub. |
| Frontend agent | Implement **T-006–T-007** in `frontend/`. Use the existing Vite starter and the public contract and fixtures in `requirements.md`. Deliver the full analyst and reviewer flow with an explicit synthetic mock mode and role-specific launch notes. | Run the frontend locally in mock mode. Use the same UI and data shapes as live mode. |

Role agents own only their directories. Each role's README records setup, launch and verification commands. The AI Engineer and backend each declare their dependencies locally. The team lead owns root files, merging, submission and the integrated demo. Use relative browser requests to `/api`, with a Vite proxy to `127.0.0.1:8000` in live development. For the demo the backend can serve the static `frontend/dist/` build at `/`.

## Source obligations and judging

**CONFIRMED** means the cited source says so. **PROPOSED** marks a team design choice. **ASSUMED** marks a planning basis. **OPEN** marks a fact to verify. The participant guide and checklist describe contest obligations. The Freedom representative program provides schedule context, with staff and jury logistics intended for their own audience. This task authorizes the planning document. The steps below are handoffs for the team.

| ID | Priority and status | Obligation and source | Verification |
| --- | --- | --- | --- |
| CON-001 | MUST · CONFIRMED | The UI uses HTML, CSS and JavaScript and should be structured for later adaptation as a Dynamics 365 HTML component. Registration and sign-in are unnecessary for the demo. Student Guide pp. 1, 4. | T-006 and T-007 provide the two demo actions in a browser. |
| CON-002 | MUST · CONFIRMED | Seed the supplied eight criteria. Let users add or edit criteria, wording, weight, answer type, scale and N/A rules. Apply a saved change from the UI to organizer data. Student Guide pp. 1–2 and Checklist pp. 1–3. | V-02 and V-05. |
| CON-003 | MUST · CONFIRMED | Evaluate RU, KZ and EN with the same checklist. Use bot and system turns as context. Show per-criterion grade, weight, points, rationale and evidence, plus the total, separate serious-error flag and section scores when configured. Link to the relevant turn or call fragment and make recordings accessible. Student Guide pp. 2–3 and Checklist pp. 1–3. | V-01 through V-04. |
| CON-004 | MUST · CONFIRMED | Save an appeal on a criterion. The reviewer sees the disputed grade, comment and evidence, confirms or changes the grade with a reason, and sees the recomputed final alongside the original. Student Guide p. 2. | V-06. |
| CON-005 | MUST · CONFIRMED | Control data opens at H+23. Stop coding and pin the last commit at H+24. Prepare a public Git repository and startup README, send its link to the organizers in advance, and keep the defense within five minutes. The frozen build can process data and edit checklists through the UI. Student Guide pp. 1, 3–4. | Team lead records commit hash, clean launch and timed demo. |
| CON-006 | MUST if paid · CONFIRMED | Name the paid model and report approximate cost per evaluation including every model call. The team may choose a local model or a free or paid service. Student Guide p. 4. | T-002 records the provider, model, sample usage and pricing basis if paid. |

| Judging input supplied by the user | Evidence to show |
| --- | --- |
| Functionality and unique features | Evidence links and the original-to-final review trail. Add the optional version comparison only after the required flow passes. |
| Usability | One list-to-detail path, a nearby transcript and checklist result, visible run state, and separate appeal and review actions. |
| Correctness on new data | Run an unseen transcript using a criterion just saved through the UI. Show the version ID, evidence and score. Repeat with a controlled change in the transcript. |
| Technical diversity | Identify the actual architecture and inference route. The stated top-50 selection preference concerns the mix of submissions. One working provider is sufficient for this plan. |

The representative program pp. 1–2 and 4 lists a 12:00 start on **7 November 2026** and submissions closing at 12:00 on **8 November**, Astana time. Applying the Student Guide's relative timing gives **11:00 on 8 November** for control access. **OPEN** Confirm any revised timing and the pitch slot with the organizers. The participant guide leaves the exact pitch schedule to them.

## Must-ship requirements

| ID | Priority · status | Behavior and owner | Acceptance |
| --- | --- | --- | --- |
| FR-001 | MUST · CONFIRMED | Backend and frontend import the organizer group by `group_id` and support JSON transcript upload. List and open individual conversations with original order, timestamps and roles. Guide pp. 2–3. | A chat and a call import and open. Reimporting identical records preserves their keys. Invalid input produces a visible error. |
| FR-002 | MUST · CONFIRMED | Backend and frontend save editable, selectable checklist configurations. Guide pp. 1–2. | Save a replacement or new criterion and run with it. A prior run still displays its original configuration. |
| FR-003 | MUST · CONFIRMED | The AI evaluator applies the active criteria to the operator's performance in the submitted transcript. Backend validates and saves the result. Guide pp. 1–2 and Checklist p. 3. | A previously unseen input goes through real inference. Each configured ID has one allowed grade, a rationale and valid turn references, including missed actions and N/A. |
| FR-004 | MUST · CONFIRMED | Backend calculates rubric points, adjusted weights, totals and serious-error flags. Frontend renders these and any configured section totals. Guide p. 2 and Checklist p. 2. | V-02 returns the specified totals. A serious error changes the flag independently of the score. |
| FR-005 | MUST · CONFIRMED | Frontend shows transcript, results and evidence links on the detail screen. Calls offer playback or a link to the recording. Guide p. 2. | Clicking evidence focuses and highlights the exact turn, with timestamp. A call recording is reachable from the card. |
| FR-006 | MUST · CONFIRMED | Backend and frontend support submitting and resolving criterion appeals. Guide p. 2. | Both confirmation and change are testable. After reload, the original, reviewer reason and recalculated final remain visible. |
| FR-007 | MUST · PROPOSED | Backend provides a CLI to run one imported group on the frozen build with a chosen checklist version. | The command reuses live evaluation, reports successes and failures, and can resume the same group and version by skipping existing live runs. |
| NFR-001 | MUST · PROPOSED | Keep secrets and official transcripts, recordings and results in local configuration and ignored storage. Logs and checked-in fixtures use synthetic data or operational metadata. | The signed URL and provider key exist only in runtime config. No official data appears in source, fixtures, logs or screenshots committed to the public repo. |
| NFR-002 | MUST · PROPOSED | Isolate failed evaluation attempts and clearly mark synthetic results. | Timeout, malformed output or missing provider leaves no successful run. The UI shows a retryable error where appropriate. A failed attempt preserves earlier results. |
| NFR-003 | SHOULD · PROPOSED | Aim for a single-conversation p95 of at most 30 seconds on a representative DEV sample under permitted conditions. | Record sample size, observed p95, retry count and throughput. Check estimated control processing time once the count is known. |
| FR-008 | COULD · PROPOSED | Show a side-by-side comparison of the same dialogue evaluated with two saved checklist versions. | Display both version IDs and changed criterion outcomes using the existing API. |

## Contract v1 · freeze before agents start

**PROPOSED** Use Python/FastAPI with SQLite for the backend and a separate Python/FastAPI evaluator. Build on the existing React/TypeScript Vite starter and ship its static HTML/CSS/JS output. Keep the UI mount and API configuration self-contained for later Dynamics 365 adaptation. The contract covers live and mock paths. The AI Engineer chooses one existing model during T-001 and owns provider integration, prompts, structured output validation, evidence selection and evaluation checks. Backend owns IDs, immutable checklist versions, independent validation at the service boundary, scoring and review. Frontend renders the API's grades and totals.

### Shared objects

Type names below are shorthand. Fields are required unless marked optional. Collections are in transcript or rubric order. IDs are strings. Enums are case-sensitive.

```text
Turn = {id, timestamp, speaker: "client"|"operator"|"bot"|"system", text}
ConversationSummary = {key, group_id, conversation_id, channel: "agent chat"|"voice call",
                       language: "RU"|"KZ"|"EN", audio_url: string|null}
Conversation = { ...ConversationSummary, turns: Turn[] }
Criterion = {id, label, instruction, kind: "binary"|"scale"|"flag", weight: int,
             scale: int[], allow_na: bool, na_rule: string|null, section: string|null}
Checklist = {version_id, name, criteria: Criterion[]}
Grade = {criterion_id, value: "yes"|"no"|"na"|int, reason, evidence_turn_ids: string[]}
Model = {provider, model}
Score = {items: [{ ...Grade, weight, effective_weight: number|null, points: number|null }],
         total: number|null, serious_error: bool,
         sections: [{name, points: number|null, possible: number|null}]}
Appeal = {criterion_id, comment, status: "open"|"resolved", decision: Decision|null}
Decision = {action: "confirm"|"change", reason, replacement?: Grade}
Evaluation = {id, conversation_key, checklist: Checklist, mode: "live"|"fixture",
              model: Model, original: Score, final: Score, appeals: Appeal[]}
```

- Treat weights as relative. Binary and scale weights are integers 1–100. Flags have weight 0. Require at least one weighted criterion, unique IDs, and nonblank labels and instructions. Scale steps are distinct nonnegative integers in ascending order, start at 0 and end above 0. Describe each step in the instruction. Other types use `scale: []`. Require a nonblank `na_rule` when `allow_na` is true, and `null` otherwise. Flags use `allow_na: false`. A criterion's section may be `null`.
- Each evaluation or corrected grade needs a nonblank rationale and at least one real turn ID from the selected conversation. For a missed action cite the place it should have occurred. For N/A explain the configured rule and cite the turn or context that supports it. Allow flags to use only `yes` or `no`. Allowed scale values come from the current criterion, and `na` requires `allow_na`.
- On import, preserve source order and exact timestamp strings. Assign `t1`, `t2`, etc. per transcript. `key` is a server-generated URL-safe ID for the pair `(group_id, conversation_id)`. Import validates every record before writing, skips identical records and returns a conflict if a known pair has different source data. Require at least one turn with nonblank text per transcript. Normalize blank chat `audio_url` to `null`.
- Backend serves transcript text for evidence by turn ID. UI focuses a call transcript turn using its source timestamp and offers playback or a link to the recording. Seek audio only when a verified recording offset is available. The organizer example supplies absolute timestamps for calls and no offset field.

### Evaluator HTTP · backend → AI evaluator

`POST /evaluate` accepts `{conversation: Conversation, checklist: Checklist}` and returns `200 {mode, model: Model, grades: Grade[]}`. For every live request, build the prompt from the full submitted checklist and transcript. Separate grading instructions from transcript data and tell the model to treat any instructions inside the transcript as dialogue text. Bot and system turns can corroborate events. Attribute actions to the speaker who performed them. Validate exactly one grade per criterion, its allowed value, its rationale and all evidence IDs. Allow at most one repair attempt within the request deadline. Backend independently validates the same contract before persisting.

Use `EVALUATOR_URL` on backend, defaulting to `http://127.0.0.1:8001`. Provider configuration and secrets are local to the evaluator. Start with a 60-second backend-to-evaluator timeout and finish inference and any repair within that budget. Fixture mode requires explicit opt-in in each service that uses it. In live mode, unexpected fixture output is an evaluator error. A browser-only mock displays the same fixture marker and never calls the live API.

### Public HTTP · frontend → backend

JSON successes use HTTP 200 for reads and decisions, 201 for creation. Import returns 200. All errors use `{error: {code, message}}` with a user-safe message.

| Route | Input | Output |
| --- | --- | --- |
| GET `/api/health` | — | `{status: "ok"}` for the backend process |
| POST `/api/imports` | `{source: "organizer", group_id}` or `{source: "upload", group_id, records: RawRecord[]}` | `{group_id, imported, skipped}` with integer counts |
| GET `/api/conversations?group_id=…` | Optional group filter | `{items: ConversationSummary[]}` |
| GET `/api/conversations/{key}` | Conversation key | `Conversation` |
| GET `/api/checklists` | — | `{items: Checklist[]}` with `default-v1` seeded and saved versions newest first |
| POST `/api/checklists` | `{name, criteria: Criterion[]}` | New immutable `Checklist` with a unique `version_id` |
| POST `/api/evaluations` | `{conversation_key, checklist_version_id}` | New `Evaluation` after inference. A deliberate rerun creates a new run. |
| GET `/api/evaluations?conversation_key=…` | Required conversation key | `{items: Evaluation[]}` newest first |
| GET `/api/evaluations/{id}` | Evaluation ID | `Evaluation` |
| POST `/api/evaluations/{id}/appeals` | `{criterion_id, comment}` with a nonblank comment | Updated `Evaluation` with one open appeal on that criterion |
| POST `/api/evaluations/{id}/appeals/{criterion_id}/decision` | `Decision` with nonblank reason. A change requires a valid replacement grade with the same criterion ID. | Updated `Evaluation` with a resolved appeal and recomputed final |

`RawRecord` uses organizer names `{conversation_id, channel, language, transcript: [{timestamp, speaker, text}], audio_url}`. The upload UI accepts a single raw record, an array, or an organizer envelope and sends a raw array, default group `UPLOAD`. The backend replaces only the `group_id` parameter in the locally configured `ORGANIZER_GET_URL`, preserving signed query parameters, and reads `data.records` when `isSuccess` is true. An empty successful group imports zero records. The participant guide documents DEV as 65 records, 60 chats and five calls, with 35 RU, 15 KZ and 15 EN. Treat those counts as a DEV verification target. The API response for a newly supplied control group determines its size.

Use 422 for invalid input, 404 for missing IDs, 409 for conflicting imports or repeated appeals/decisions, 503 for unavailable configuration, 502 for upstream failures or invalid responses and 504 for upstream timeouts. Keep one appeal per evaluation and criterion. In a single transaction, apply a decision only while the appeal is open, compute final grades by overlaying all resolved changes on the original grades and recompute with the frozen checklist. Confirmation preserves the grade. Frontend disables duplicate submissions while a write is pending and keeps the previous result visible after a failed request.

### Default rubric and deterministic scoring

Seed version `default-v1` named `Чек-лист Freedom Broker`. Use the Russian labels below and put the decision rules in `instruction` and `na_rule`. Group C01–C02 as `Начало и понимание запроса`, C03–C04 as `Безопасность и решение`, C05–C07 as `Ведение и завершение диалога`, and C08 as `Грубые нарушения`.

| ID and label | Kind · weight · scale | Decision rule and applicability |
| --- | --- | --- |
| C01 Установление контакта | binary · 10 | Yes if the operator greets in the client's language and introduces themselves in the first response. |
| C02 Выявление потребности | binary · 15 · N/A | Yes if the operator uses known details and clarifies missing information before answering. N/A if the customer provided enough information at the start. |
| C03 Идентификация | binary · 20 · N/A | Yes if the transcript confirms identity verification before protected disclosure or action. N/A for a request that requires no verification. If verification was required and remains unconfirmed, use no. |
| C04 Корректная и полная консультация | scale · 20 · `[0,5,10,15,20]` · N/A | 20 all material questions answered or correct next step given. 15 main issue resolved with a minor omission. 10 material issue still open. 5 generic guidance without an actionable next step. 0 no substantive answer or a key error. N/A if the chat ended before the client made a request. |
| C05 Эмпатия и клиентоориентированность | binary · 15 | Yes for politeness and, when the client expresses dissatisfaction or inconvenience, acknowledgment of the specific problem. |
| C06 Управление диалогом, скорость и грамотность | scale · 15 · `[0,4,7,10]` | 10 clear and coherent, with a warning for evident waits. 7 one noticeable lapse with the conversation still understandable. 4 client needs clarification because of wording or sequence. 0 incoherent or contradictory exchange that is hard to follow. |
| C07 Завершение | binary · 5 · N/A | Yes if the operator summarizes or offers further help and says goodbye. N/A if the dialogue ended before the operator could close it. |
| C08 Грубые ошибки | flag · 0 | Yes for an operator insult, a proposal for paid services outside the company, or disclosure of confidential information. A private paid offer alone suffices. |

Exclude the three-minute first-response threshold, tags and attachments from the initial rubric. Use the transcript for the supplied checks. Consultation measures resolution and correctness. Dialogue management measures clarity and flow. Cite visible evidence and avoid treating unsupported policy assertions as verified facts.

Let `W` be the sum of weights of applicable weighted criteria. For each such criterion, effective weight is `100 × weight / W`. Multiply by 1 for yes, 0 for no, or `value / max(scale)` for a scale. N/A and flags have null points and effective weight. The total is the sum of unrounded criterion contributions, rounded to two decimals. If `W = 0`, total is null. **PROPOSED** Use decimal half-up for ties. Section points and possible points sum the contributions and effective weights in that section. A section without applicable weighted rows has null totals. Round displayed points, effective weights and sections independently to two decimals. Flag `serious_error` if any flag grade is yes. Keep the total independent of the flag.

### Synthetic fixture · copy locally into each role's harness

Use `group_id: "SYNTH"`, `conversation_id: "ru-001"`, `channel: "agent chat"`, `language: "RU"`, `audio_url: null`. For the browser mock, use `key: "demo-001"`. Backend assigns its own key and tests read it from the API. Mark the mocked run `mode: "fixture"` and use `{provider: "fixture", model: "synthetic-v1"}`. The grades below include a deliberately disputable C06 for testing the review.

| ID · timestamp · speaker | Text |
| --- | --- |
| t1 · 00:00 · client | Какой график демо-чата и можно ли задать вопрос на английском? |
| t2 · 00:02 · operator | Здравствуйте! Меня зовут Алия. |
| t3 · 00:08 · operator | Демо-чат работает по будням с 9:00 до 18:00. |
| t4 · 00:12 · system | Чат закрыт оператором. |

| Criterion | Value | Reason | Evidence IDs |
| --- | --- | --- | --- |
| C01 | `"yes"` | Оператор поздоровался на русском и представился. | t2 |
| C02 | `"na"` | Для ответа на оба общих вопроса исходных данных достаточно. | t1 |
| C03 | `"na"` | Вопрос о демо-чате не требует идентификации. | t1 |
| C04 | `15` | График указан, вопрос о языке остался без ответа. | t1, t3 |
| C05 | `"yes"` | Оператор общался вежливо. | t2, t3 |
| C06 | `7` | Ответ понятен, но вопрос о языке остался вне последовательности ответа. | t1, t3 |
| C07 | `"no"` | Чат закрыт без прощания. | t3, t4 |
| C08 | `"no"` | В проверенных репликах грубых ошибок не выявлено. | t2, t3 |

Original total **77.69** (50.5 / 65 × 100). The four sections in rubric order show earned/possible points of **15.38/15.38**, **23.08/30.77**, **39.23/53.85**, and **null/null**. Submit a C06 appeal that distinguishes incomplete consultation from dialogue clarity. Resolve it with replacement value **10**, reason and t2–t3 evidence. Final total **84.62** (55 / 65 × 100). The original stays **77.69**. A separate confirmation test keeps the original grade and total.

For a fresh-input test, replace C05 in the UI with `Оператор явно предложил ответить на английском`, still binary with weight 15. Save a version and select it. On the original turns the new criterion is no. On a new dialogue ID with the same turns plus `Могу ответить на английском.` in the operator's answer it is yes. Check live mode, the saved criterion wording and evidence pointing to the changed turn. Also exercise a synthetic KZ chat and an EN call using the source speaker roles and timestamp formats.

## One-shot milestones

Effort is **ASSUMED** focused work with one owner per role and an available provider or mock. Handoff gates are observable results. Each role can implement its assigned milestones without waiting for a different branch.

| Ticket · owner | Outcome · estimate | Inputs and exit check |
| --- | --- | --- |
| T-001 · AI Engineer | Integrate one LLM and expose the evaluator · 1–2 h | In the first 45 minutes, run one synthetic dialogue through a candidate model and record access, latency, usage and output validity. Exit with a runnable `POST /evaluate` and an offline contract check using arbitrary criterion IDs. FR-003, NFR-002, CON-006. |
| T-002 · AI Engineer | Apply saved rubrics to fresh transcripts and verify the grades · 3–5 h | Build the rubric-driven prompt and validate the provider response. Check the changed C05 pair, KZ and EN dialogues, verification-required and N/A cases, a serious error, and an instruction embedded in a transcript. Exercise rejection of invalid grades and evidence IDs, plus provider timeouts. Record expected and observed grades for the checked criteria, launch commands, latency and model usage. FR-003, NFR-002, NFR-003. |
| T-003 · Backend | Import, persistence and rubric versions · 2–3 h | Start from the schema and a synthetic source stub. In the first 30 min, check DEV access when configured and verify wrapper, counts, role/timestamp values and audio links without logging data. Exit with idempotent import, stable turn IDs, and immutable rubric versions after restart. FR-001, FR-002, NFR-001. |
| T-004 · Backend | Score and review a run · 3–4 h | Develop in parallel with the AI Engineer using your own evaluator stub. Test both fixture totals, a standalone serious flag, no-applicable result, rejected malformed grades and persisted original/final appeal history. FR-003, FR-004, FR-006, NFR-002. |
| T-005 · Backend | Run and resume a control group · 1–2 h | Reuse T-003 and T-004. In an isolated test database, simulate a live response for one synthetic record and an upstream failure for another. A rerun processes failed or pending records and skips existing live results for the same version. FR-007, CON-005. |
| T-006 · Frontend | Import, open and evaluate a conversation · 2–3 h | Start from the fixture and mock API. Show list, upload/import, version selection, loading/error/empty states, result, evidence jump and audio link. Switch to live requests through one API boundary. FR-001, FR-003–FR-005. |
| T-007 · Frontend | Edit a checklist and resolve an appeal · 3–4 h | Build on T-006 and the same mock. Save/select a changed rubric, submit an appeal, and confirm/change a grade with original and final visible. Rehearse with a clear synthetic badge and verify the static build with `npm run build`. FR-002, FR-006, CON-001. |
| T-008 · Team lead | Integrated build, freeze and timed defense · reserve 2–3 h | Merge role branches, run V-01 through V-08, verify secret exclusion and write a root quick-start. Send the public repo link in advance and record the H+24 commit. CON-005. |

By **H+4**, aim to send one synthetic transcript from the UI through the backend and evaluator HTTP and back. Show the fixture marker if using a stub. Switch to real inference on fresh synthetic data as soon as T-001 passes. Aim for the full flow by **H+12** and rehearse on the integrated build by **H+20**. At **H+23** import the newly supplied group, run it on the selected checklist and inspect results while processing continues. At **H+24** freeze the judged commit. Use the assigned pitch slot to plan how much processing time is available. If processing the whole group would exceed the window, prioritize the conversations the organizers request or designate for judging and report the observed coverage.

**OPEN** Confirm provider access, quotas, model cost, available hardware and permission to send official data to a third-party service before that use. Select an allowed local inference route if available when external data use is unresolved. Test the live path on synthetic data while checking permissions. The signed DEV URL was supplied separately and its live response was not verified during planning. If organizer GET fails, use an organizer-provided JSON export through upload when available. If live inference fails, show labeled fixture results only for UI and review rehearsal. A fixture run cannot satisfy the live-evaluation checks.

Keep authentication, multi-user permissions, audio transcription, intonation scoring, production Dynamics integration, multi-provider orchestration and dashboards outside the MVP. Drop FR-008 first if time is tight. Keep single-dialogue live evaluation, saved rubric replacement and appeal review.

## Verification and five-minute defense

| Check | Pass evidence | Owner |
| --- | --- | --- |
| V-01 · data and navigation | DEV, when reachable, matches documented counts. A call and chat open with exact timestamps and speakers. Evidence jumps to the intended turn and the recording link opens. FR-001, FR-005. | Backend + frontend |
| V-02 · score | Fixture returns 77.69 with two N/A rows, correct section totals and flag false. A separate C08 yes case sets the flag without moving the total. An all-N/A custom weighted rubric returns a null total. FR-004. | Backend |
| V-03 · real inference | Fresh RU, KZ and EN inputs return valid grades with references. Spot-check identity verification, bot/operator attribution and a transcript containing an instruction to override the rubric. The requested checklist still governs the output. FR-003. | AI Engineer |
| V-04 · failure | Invalid upload, duplicate import, upstream outage/timeout and invalid evaluator output produce the specified state. Successful past results survive. NFR-002. | Backend + frontend |
| V-05 · saved change | Change C05 through the UI, run the fresh-input pair through the live evaluator and inspect the changed evidence. An earlier result still shows its prior rubric. FR-002, FR-003. | All roles |
| V-06 · review | Resolve one appeal by confirmation and another by change. The fixture changes from 77.69 to 84.62 and shows both totals and the decision after reload. FR-006. | Backend + frontend |
| V-07 · control run | Use a clean startup and test CLI resume on synthetic data. At release, record the control group, checklist version, processed count, failures and timing from the live build. FR-007, NFR-003. | Team lead + backend |
| V-08 · submission | Follow the root README from a clean clone, check public contents for secret and data exclusion, record the frozen commit and time the defense at five minutes or less. CON-005, NFR-001. | Team lead |

**Defense** — 0:00–1:00 open a dialogue from the list. 1:00–3:00 show grades, an evidence jump, N/A and the total. 3:00–4:00 appeal a grade and show the original alongside the reviewed result. 4:00–5:00 save the replacement criterion and launch or show the live run created with that exact version. If the provider is slow, begin processing on the frozen build before the pitch and identify the live run and input on screen.
