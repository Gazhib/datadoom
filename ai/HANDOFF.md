# AI · HANDOFF

Branch agent/ai · updated 2026-11-07T22:19:11+05:00 · last green code commit be64fe1

## Status

| Task | Status | Commit |
| --- | --- | --- |
| Baseline | 37 original tests passed at 5611049 | f665a7a |
| A-F1, A-F2, A-F3 | Ollama context sizing and limit; doubled budget for length stops; malformed server responses fail without repair | 79f4394 |
| A1, A3 | LAN and 8/16 GB presets, cached probes, fallback routing, scheduling, warmup, doctor and optional panel diagnostics. Real LAN hardware test remains. | 79f4394, be64fe1 |
| A2, A4 | LangGraph is the default after parity. Legacy remains selectable. NDJSON progress and disconnect handling verified. | 79f4394 |
| A-F4 | Verifier uses jobs when available, otherwise v1, with a configurable 660 s default. | 6bd5971 |
| A5 | 24 synthetic cases and reports work in both engines. Targeted warm Qwen experiment did not improve accuracy; V-03 remains open. | df2b72e |
| A6 | A queued judge on a shared host can skip after quorum and a mathematically fixed value for every criterion. | 79f4394, be64fe1 |
| A7 | Optional work deferred. | — |

## How to run and verify

From the WSL worktree root:

```bash
python -m pip install -r ai/requirements.txt
for engine in legacy langgraph; do
  EVALUATOR_TEST_ENGINE=$engine python -m unittest discover -s ai -p 'test_*.py'
done
python -m ai.eval.lan
python -m ai.eval.run --offline
python -m ai.eval.run --offline --engine legacy
docker build --target evaluator -t datadoom-evaluator:agent-ai .
docker run --rm -e OLLAMA_URL=http://host.docker.internal:11434 \
  -e EVALUATOR_JUDGES_FILE=ai/presets/one-laptop-8gb.yaml \
  datadoom-evaluator:agent-ai python -m ai.doctor
```

Both engine suites passed 63 tests. The evaluator image built and container preflight
saw three usable models. For a live standalone smoke, start Uvicorn with the 8 GB
preset as documented in [Three judges on one laptop](README.md#three-judges-on-one-laptop).
Then send the fixture:

```bash
curl --fail-with-body -sS -H 'Content-Type: application/json' \
  --data-binary @ai/smoke.json http://127.0.0.1:8001/evaluate
```

## Measurements

- Host: Ubuntu 22.04 in WSL, 8 CPUs and 7.6 GiB RAM, Ollama 0.40.15.
  Baseline installed models: Qwen3 1.7B (1.4 GB) and Llama 3.2 3B (2.0 GB).
  Pulled Gemma 3 1B (806 MB) for the 8 GB preset. All three report Q4_K_M.
  Docker reaches this same WSL Ollama through `host.docker.internal:11434`:
  the Windows listener is `wslrelay`, the WSL listener is Ollama and the
  inventory (including newly pulled Gemma) matches. Peak system memory was not measured.
- Real 8 GB swap mode: the one-criterion HTTP responses matched exactly for
  legacy (274.47 s) and LangGraph (308.54 s). LangGraph returned all eight
  grades with three contributing models in 299.97 s. These runs used the
  actual Ollama HTTP server and the evaluator ASGI app. They started with
  the models unloaded; Ollama showed none loaded after the runs.
- Three real loopback HTTP ports, 200 ms stub inference each: 0.343 s
  end to end with overlapping calls; 0.471 s after stopping the third
  server, with its fallback serialized on the main host. A later run
  also preserved overlap and serialization under CPU load (0.726/1.388 s).
- All 24 offline cases ran against each engine. These are stub measurements.
  On the two live V-03 cases with one warm Qwen3 1.7B judge, the baseline
  was 1/4 correct including evidence (p95 11.639 s). Adding generic
  speaker/event anchors and explicit N/A guidance was still 1/4
  (p95 12.288 s). It was not adopted. The models ran locally without API fees.

## Decisions

- Provisional LAN mix: Qwen3 4B, Gemma 3 4B and Llama 3.2 3B. Real LAN
  accuracy and speed should decide the final choice.
- The 8 GB preset uses Ollama swap mode to bound memory. The measured
  fallback was slower than the estimated 60–180 s; plan around roughly five
  minutes on this host. Prefer warmed models on independent hosts for the demo.
- A6 fixes grade values before skipping. Rationales, evidence and agreement
  summarize the judges that actually ran.
- Hosted judges are shown as configured in preflight and are not sent local
  health probes. No hosted providers were called for these checks.
- LangGraph 1.2.17 is pinned along with its resolved dependencies. The legacy
  engine can be removed after the humans confirm the merge.

## Contract change requests

None. `EVALUATOR_EMIT_PANEL` remains false until the backend accepts the
optional field. Use the evaluator directly until the backend supports the
longer timeout; v1 backend calls are still capped at 60 seconds.

## Root-file changes

Added one line to the evaluator Docker stage to copy the YAML presets and
one matching .dockerignore inclusion. No backend, frontend or Compose files changed.

## Known issues and next steps

Run the actual three-device smoke in [Three laptops on a LAN](README.md#three-laptops-on-a-lan)
and repeat after stopping a judge. Then run the targeted live harness:

```bash
python -m ai.eval.run --judges-file ai/presets/three-laptops-lan.yaml \
  --case kz-unverified-injection --case en-system-verified
```

For the full accuracy report, omit the case flags. Compare compact transcript
lines against the baseline on the same panel; retain changes only after an
accuracy improvement with less than 20% added latency.
