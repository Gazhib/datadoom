# Datadoom evaluator

T-001 provides `POST /evaluate` at `127.0.0.1:8001`. It takes a conversation and checklist and returns live model metadata and one grade per criterion in checklist order. The backend owns scoring.

## Provider configuration

Set `EVALUATOR_PROVIDER` in the evaluator process to choose where inference runs. The default is `llama.cpp`. Each request uses the selected provider for inference and any repair, and the result identifies the provider and model used.

| `EVALUATOR_PROVIDER` | Required settings | Default model | Model override |
| --- | --- | --- | --- |
| `llama.cpp` | Local model server. `LLAMA_CPP_URL` defaults to `http://127.0.0.1:8080`. | `Qwen3-1.7B-Q4_K_M` | `LLAMA_CPP_MODEL` |
| `openai` | `OPENAI_API_KEY` | `gpt-5.4-mini` | `OPENAI_MODEL` |
| `qwen` | `DASHSCOPE_API_KEY` and `QWEN_BASE_URL` | `qwen-plus` | `QWEN_MODEL` |
| `gemini` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `gemini-3.1-flash-lite` | `GEMINI_MODEL` |

For Qwen, use the HTTPS OpenAI-compatible base URL for your Alibaba Cloud Model Studio workspace and key region. For example, a Singapore workspace URL is `https://<workspace-id>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`. The evaluator appends `/chat/completions`. Model overrides should support OpenAI Structured Outputs, Qwen JSON mode with thinking disabled, or Gemini structured output, respectively. [OpenAI Docs](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [Alibaba Cloud Model Studio](https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen), [Gemini API](https://ai.google.dev/api/generate-content).

Hosted providers receive the submitted checklist and transcript. Keep keys in the evaluator's environment and use synthetic data until organizers approve external processing of official transcripts. Calls may incur provider charges, including the single repair attempt if used.

## Start the evaluator

Use Python 3.11 or newer. From the repository root, install the dependencies and start the evaluator in PowerShell.

```powershell
python -m venv ml/.venv
.\ml\.venv\Scripts\python.exe -m pip install -r ml/requirements.txt
.\ml\.venv\Scripts\python.exe -m uvicorn ml.main:app --host 127.0.0.1 --port 8001
```

For a hosted provider, set its environment variables before starting Uvicorn. For example, in PowerShell 7 use `$env:EVALUATOR_PROVIDER = 'openai'` and `$env:OPENAI_API_KEY = Read-Host 'OpenAI API key' -MaskInput`. For llama.cpp, start the local model server using the steps below. Restart the evaluator after changing its environment.

## Start the local model server

Extract the [llama.cpp b12184](https://github.com/ggml-org/llama.cpp/releases/tag/b12184) build for your platform. Download the [official Qwen3-1.7B Q8_0 GGUF](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/blob/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf) (1.83 GB). Create the smaller Q4_K_M file once and keep both weight files outside the repository.

```powershell
& 'C:\path\to\llama-quantize.exe' --allow-requantize 'C:\models\Qwen3-1.7B-Q8_0.gguf' 'C:\models\Qwen3-1.7B-Q4_K_M.gguf' Q4_K_M 4
& 'C:\path\to\llama-server.exe' -m 'C:\models\Qwen3-1.7B-Q4_K_M.gguf' --alias Qwen3-1.7B-Q4_K_M --host 127.0.0.1 --port 8080 -c 8192 -np 1 --no-context-shift --reasoning off -t 6 -tb 8 --log-disable
```

Start the evaluator in a second terminal. `LLAMA_CPP_MODEL` must match the server's alias. The local model requires no API key and has no per-call provider charge.

## Verify

Run the offline contract tests from the repository root. They replace the upstream HTTP transport and exercise each provider's request and response format. Use the live smoke test with your configured key to verify hosted access.

```powershell
.\ml\.venv\Scripts\python.exe -m unittest discover -s ml -p 'test_*.py' -v
```

For the T-001 live smoke test, send the synthetic Russian dialogue with the greeting criterion under a new ID.

```powershell
$request = Get-Content -Raw -Encoding utf8 ml/smoke.json | ConvertFrom-Json
$request.checklist.criteria = @($request.checklist.criteria[0])
$request.checklist.criteria[0].id = 'greeting-live'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8001/evaluate -ContentType 'application/json; charset=utf-8' -Body ($request | ConvertTo-Json -Depth 10 -Compress) | ConvertTo-Json -Depth 10
```

Use the same endpoint to exercise all eight criteria when measuring full-checklist performance.

```powershell
curl.exe --fail-with-body -sS -H 'Content-Type: application/json' --data-binary '@ml/smoke.json' -w '\nHTTP %{http_code} in %{time_total}s\n' http://127.0.0.1:8001/evaluate
```

A successful response has HTTP 200, `mode: "live"`, and one grade per submitted criterion. Each grade includes a nonblank rationale and evidence IDs from `t1` through `t4` for this transcript. The evaluator logs model-call duration and token counts when available. It allows one repair for invalid output within a shared 55-second inference budget. Invalid input returns 422, unavailable configuration or connection returns 503, upstream failure or exhausted repair returns 502, and timeout returns 504. Error messages omit upstream response bodies and transcript text.

## Provider spike

On the Windows test host, Qwen3-1.7B Q4_K_M on CPU returned HTTP 200 in **27.87 s** for the one-criterion request. The response matched the expected grade of `yes` and cited the operator greeting at `t2`. The single model call used 395 prompt tokens and 57 completion tokens.

The full eight-criterion request hit the deadline with Qwen3-1.7B Q4_K_M on CPU (55.29 s) and Intel Iris Plus Vulkan (55.24 s), and with Qwen3-0.6B Q8_0 on CPU (55.48 s). All three requests returned HTTP 504. These are end-to-end request times from individual runs.

After adding provider selection, the local one-criterion smoke test returned HTTP 200 in 8.07 s with the same grade and evidence. The local full fixture returned HTTP 504 in 55.14 s after the first completion failed validation and the repair reached the deadline. Hosted providers were exercised with mocked HTTP responses. Live hosted access requires a configured key.
