# Datadoom AI evaluator

T-001 provides `POST /evaluate` at `127.0.0.1:8001`. It takes a conversation and checklist, has a panel of three judges grade it in parallel, and returns one combined grade per criterion in checklist order. The backend owns scoring.

## Judge panel

[`judges.yaml`](judges.yaml) defines the panel. By default it has three local Ollama judges from different model families, so their mistakes are less likely to coincide: `qwen3:1.7b`, `gemma3:4b` and `phi4-mini`. Each judge gets the same prompt, schema and one repair attempt. The evaluator combines their grades per criterion:

- **Yes/no and N/A:** the value most judges chose. A tie goes to the judge listed first, so list the judge you trust most first.
- **Scale:** N/A is decided by the same vote. Otherwise the result is the lower median of the numeric grades, which is always a value some judge gave.
- **Reason and evidence:** the reason comes from the first judge that agrees with the result. Evidence merges the turns cited by every agreeing judge, most-cited first.

At least `quorum` judges must return valid grades. The default is a majority, 2 of 3. Judges that fail or miss the shared `timeout_seconds` deadline (55 s) are left out. Below quorum, the request fails with the shared error when every judge failed the same way, or with `502 quorum_not_met` listing each judge's error code. The result model is `panel` with the contributing judges, for example `ollama/qwen3:1.7b + ollama/gemma3:4b + ollama/phi4-mini`. The evaluator logs each judge's timing and token use, the mean agreement, and the votes for every criterion where the judges disagreed.

Change a judge in the YAML or with variables in the root `.env`. The YAML reads `${NAME}` and `${NAME:-default}` placeholders, so `JUDGE_2_PROVIDER=openai` and `JUDGE_2_MODEL=gpt-5.4-mini` replace the second judge without editing the file. Set the model whenever you change a provider. Each judge accepts `name`, `provider`, `model`, `url`, `api_key_env` and `temperature`. The file never holds keys: `api_key_env` names the variable that holds one. Compose mounts the file into the evaluator and every evaluation reads it again, so edits apply without a rebuild. Set `EVALUATOR_JUDGES_FILE` to use another file.

Three judges triple the inference work. On CPU, three local models compete for the same cores and memory, and the full checklist already took 19–45 s with one model (see below). Make sure Ollama can keep all three models loaded and has enough RAM. Otherwise use a GPU or mix in hosted judges. Through the backend, the deadline must stay below `UPSTREAM_TIMEOUT_SECONDS`, which is at most 60 s.

## Providers

When a judge leaves `model`, `url` or `api_key_env` unset, the evaluator uses the provider-wide variables below, then the built-in default.

| `provider` | Required settings | Default model | Model override |
| --- | --- | --- | --- |
| `llama.cpp` | Local model server. `LLAMA_CPP_URL` defaults to `http://127.0.0.1:8080`. | `Qwen3-1.7B-Q4_K_M` | `LLAMA_CPP_MODEL` |
| `ollama` | Local Ollama server. `OLLAMA_URL` defaults to `http://127.0.0.1:11434` outside Docker. | `qwen3:1.7b` | `OLLAMA_MODEL` |
| `openai` | `OPENAI_API_KEY` | `gpt-5.4-mini` | `OPENAI_MODEL` |
| `qwen` | `DASHSCOPE_API_KEY` and `QWEN_BASE_URL` | `qwen-plus` | `QWEN_MODEL` |
| `gemini` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `gemini-3.1-flash-lite` | `GEMINI_MODEL` |

For Qwen, use the HTTPS OpenAI-compatible base URL for your Alibaba Cloud Model Studio workspace and key region. For example, a Singapore workspace URL is `https://<workspace-id>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`. The evaluator appends `/chat/completions`. Model overrides should support OpenAI Structured Outputs, Qwen JSON mode with thinking disabled, or Gemini structured output, respectively. [OpenAI Docs](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [Alibaba Cloud Model Studio](https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen), [Gemini API](https://ai.google.dev/api/generate-content).

Hosted providers receive the submitted checklist and transcript. Keep keys in the evaluator's environment and use synthetic data until organizers approve external processing of official transcripts. Calls may incur provider charges, including the single repair attempt if used.

## Start the evaluator

Use Python 3.11 or newer. From the repository root, install the dependencies and start the evaluator in PowerShell.

```powershell
python -m venv ai/.venv
.\ai\.venv\Scripts\python.exe -m pip install -r ai/requirements.txt
.\ai\.venv\Scripts\python.exe -m uvicorn ai.main:app --host 127.0.0.1 --port 8001
```

The default panel needs Ollama with `qwen3:1.7b`, `gemma3:4b` and `phi4-mini` pulled. For a hosted judge, set its variables before starting Uvicorn. For example, in PowerShell 7 use `$env:JUDGE_2_PROVIDER = 'openai'`, `$env:JUDGE_2_MODEL = 'gpt-5.4-mini'` and `$env:OPENAI_API_KEY = Read-Host 'OpenAI API key' -MaskInput`. For llama.cpp, start one model server per judge using the steps below and set each judge's `url`. Restart the evaluator after changing its environment. YAML edits apply to the next evaluation.

## Use Ollama with Docker

Run `ollama pull qwen3:1.7b`, `ollama pull gemma3:4b` and `ollama pull phi4-mini` if the models have not been downloaded. Keep the Ollama service running. The interactive `ollama run` prompt can be closed because Datadoom uses Ollama's HTTP server.

Compose points the judges at `http://host.docker.internal:11434`. To use another Ollama server, set it in the ignored `.env` file at the repository root.

```dotenv
OLLAMA_URL=http://host.docker.internal:11434
```

Rebuild the evaluator using the same Compose project as your existing Datadoom stack. Import a JSON transcript, open the conversation and select **Run evaluation**. The result identifies the model as `panel / ollama/qwen3:1.7b + ollama/gemma3:4b + ollama/phi4-mini`. Datadoom sends a grade schema and disables Qwen's thinking output through [Ollama's chat API](https://docs.ollama.com/api/chat).

## Start the local model server

Extract the [llama.cpp b12184](https://github.com/ggml-org/llama.cpp/releases/tag/b12184) build for your platform. Download the [official Qwen3-1.7B Q8_0 GGUF](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/blob/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf) (1.83 GB). Create the smaller Q4_K_M file once and keep both weight files outside the repository.

```powershell
& 'C:\path\to\llama-quantize.exe' --allow-requantize 'C:\models\Qwen3-1.7B-Q8_0.gguf' 'C:\models\Qwen3-1.7B-Q4_K_M.gguf' Q4_K_M 4
& 'C:\path\to\llama-server.exe' -m 'C:\models\Qwen3-1.7B-Q4_K_M.gguf' --alias Qwen3-1.7B-Q4_K_M --host 127.0.0.1 --port 8080 -c 8192 -np 1 --no-context-shift --reasoning off -t 6 -tb 8 --log-disable
```

Start the evaluator in a second terminal. `LLAMA_CPP_MODEL` must match the server's alias. On Windows with Docker Desktop, the standard Compose stack reaches this host process at `http://host.docker.internal:8080`. Start the model before running an evaluation in Docker. The local model requires no API key and has no per-call provider charge.

## Verify

Run the offline contract tests from the repository root. They replace the upstream HTTP transport and exercise each provider's request and response format. Use the live smoke test with your configured key to verify hosted access.

```powershell
.\ai\.venv\Scripts\python.exe -m unittest discover -s ai -p 'test_*.py' -v
```

For the T-001 live smoke test, send the synthetic Russian dialogue with the greeting criterion under a new ID.

```powershell
$request = Get-Content -Raw -Encoding utf8 ai/smoke.json | ConvertFrom-Json
$request.checklist.criteria = @($request.checklist.criteria[0])
$request.checklist.criteria[0].id = 'greeting-live'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8001/evaluate -ContentType 'application/json; charset=utf-8' -Body ($request | ConvertTo-Json -Depth 10 -Compress) | ConvertTo-Json -Depth 10
```

Use the same endpoint to exercise all eight criteria when measuring full-checklist performance.

```powershell
curl.exe --fail-with-body -sS -H 'Content-Type: application/json' --data-binary '@ai/smoke.json' -w '\nHTTP %{http_code} in %{time_total}s\n' http://127.0.0.1:8001/evaluate
```

A successful response has HTTP 200, `mode: "live"`, and one grade per submitted criterion. Each grade includes a nonblank rationale and evidence IDs from `t1` through `t4` for this transcript. The evaluator logs model-call duration and token counts when available. It allows one repair for invalid output within a shared 55-second inference budget. Invalid input returns 422, unavailable configuration or connection returns 503, upstream failure or exhausted repair returns 502, and timeout returns 504. Error messages omit upstream response bodies and transcript text.

## Live acceptance suite

Start the local model and the [standard Docker stack](../README.md#standard-docker-stack). Run the acceptance suite from the repository root. It imports four synthetic conversations under a fresh group, saves an edited checklist version and checks five real evaluations through the backend. Use an isolated test stack to keep the test data separate.

```powershell
.\ai\.venv\Scripts\python.exe -m ai.verify_live --base-url http://127.0.0.1:8000
```

Use `--prepare-only` to import the conversations for a browser run. In **Edit checklist**, replace C05's label with `Оператор явно предложил ответить на английском` and set the instruction to `Да, только если оператор явно предложил ответить на английском.` Save and evaluate `ru-original` and `ru-offer` with the saved version. The expected C05 grades are **No** and **Yes**, with the offer cited at `t3`. Run the original against `default-v1` before editing to compare its preserved checklist in the run history.

### Local Docker results

On 7 November 2026, Docker Desktop reached the host's Qwen3-1.7B Q4_K_M model. All five synthetic evaluations returned eight grades with valid turn IDs. The evaluator constrained each criterion's ID, grade values and evidence IDs during decoding and retained its output validation before returning results.

| Check | Expected | Observed |
| --- | --- | --- |
| RU baseline | C01 yes at `t2` and C03 N/A at `t1` | Matched both spot checks. |
| KZ bot greeting, unverified disclosure and transcript injection | C01 no and C03 no | Both were yes. C01 cited the bot greeting at `t1` and C03 cited the unverified disclosure at `t3`. |
| EN verified call and private paid offer | C03 yes at `t3` and C08 yes at `t5` | C03 was N/A at `t2`. C08 was yes at `t5` and the serious-error flag was set. |
| Saved C05 pair | No without the offer and yes citing `t3` with it | Both matched through the API and with a version saved in the browser. The previous run retained `default-v1`. |

The five sequential synthetic runs took 19.39–45.32 seconds end to end, with a nearest-rank p95 of **45.32 seconds** and throughput of **0.036 evaluations per second**. The first request included cold model processing. The evaluator logged 1,083–1,118 prompt tokens and 192–271 completion tokens per call, with zero repairs and no provider charges.

A separate Russian office-hours dialogue returned eight live grades in 37.14 seconds. C01 was correctly yes at `t2`. C03 was yes where the public question called for N/A. A revised prompt and smaller rubric batches did not resolve the KZ and EN errors, and the higher-precision Q8_0 model timed out on the KZ probe. V-03 remains open. The 30-second target on representative organizer DEV data still requires a separate measurement.

## Provider spike

On the Windows test host, Qwen3-1.7B Q4_K_M on CPU returned HTTP 200 in **27.87 s** for the one-criterion request. The response matched the expected grade of `yes` and cited the operator greeting at `t2`. The single model call used 395 prompt tokens and 57 completion tokens.

The full eight-criterion request hit the deadline with Qwen3-1.7B Q4_K_M on CPU (55.29 s) and Intel Iris Plus Vulkan (55.24 s), and with Qwen3-0.6B Q8_0 on CPU (55.48 s). All three requests returned HTTP 504. These are end-to-end request times from individual runs.

After adding provider selection, the local one-criterion smoke test returned HTTP 200 in 8.07 s with the same grade and evidence. The local full fixture returned HTTP 504 in 55.14 s after the first completion failed validation and the repair reached the deadline. Hosted providers were exercised with mocked HTTP responses. Live hosted access requires a configured key.
