# AI · HANDOFF

Branch agent/ai · baseline 5611049 · 7 November 2026

## Status

- Baseline: 37 tests passed on Python 3.11 in the WSL worktree.
- A-F1, A1, A3: implementation in place; extending the LAN and HTTP checks.
- A2, A-F2–A-F4, A4–A6: in progress.

## How to run and verify

From the repository root, install ai/requirements.txt into a Python 3.11+ environment. Run
`python -m unittest discover -s ai -p 'test_*.py'` and `python -m ai.doctor`.

## Measurements

WSL Ubuntu 22.04, 7.6 GiB RAM, Ollama 0.40.15. Initially pulled: qwen3:1.7b (1.4 GB)
and llama3.2:3b (2.0 GB), both Q4_K_M; no model was loaded. The existing Docker evaluator
reaches `host.docker.internal:11434`; its API returned the same version and initial
model inventory as WSL. The endpoint is through the Windows host. An inventory match
alone cannot identify which process is listening behind that address.

## Decisions

LAN defaults use Qwen, Gemma and Llama as a provisional mix. The 8 GB preset uses swap
mode so Ollama unloads each model after inference.

## Contract change requests

None.

## Root-file changes

The evaluator image copies the YAML presets. The matching .dockerignore rule includes only those files.

## Known issues and next steps

Three real judge laptops are not available in this worktree. Verify against loopback
servers and run the real LAN commands in ai/README.md before the demo.
