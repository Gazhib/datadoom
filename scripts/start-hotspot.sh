#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

mac_ip="${1:-192.168.0.40}"
windows_ip="${2:-192.168.0.81}"
evaluator_python="${DATADOOM_WSL_PYTHON:-$HOME/datadoom-agents/ai/ai/.venv/bin/python}"

if [[ ! -x "$evaluator_python" ]]; then
    printf 'Evaluator Python was not found at %s. Set DATADOOM_WSL_PYTHON to the evaluator virtualenv Python.\n' "$evaluator_python" >&2
    exit 1
fi

export JUDGE_1_PROVIDER=ollama JUDGE_1_MODEL=qwen3:8b JUDGE_1_URL="http://$mac_ip:11434"
export JUDGE_2_PROVIDER=ollama JUDGE_2_MODEL=gemma3:4b JUDGE_2_URL="http://$windows_ip:11434"
export JUDGE_3_PROVIDER=ollama JUDGE_3_MODEL=llama3.2:3b JUDGE_3_URL=http://127.0.0.1:11434
export EVALUATOR_EMIT_PANEL=true JUDGES_TIMEOUT_SECONDS=540 JUDGE_TIMEOUT_SECONDS=360

if [[ -n "$(ss -Hlt 'sport = :8011')" ]]; then
    "$evaluator_python" - <<'PY'
import json
import os
from urllib.request import urlopen

try:
    with urlopen("http://127.0.0.1:8011/judges", timeout=5) as response:
        judges = json.load(response)["judges"]
    running = {(row["name"], row["provider"], row["model"], row["host"]) for row in judges}
except (OSError, KeyError, TypeError, ValueError):
    raise SystemExit("Port 8011 is busy. Check what is running in WSL before starting another evaluator.")

expected = {
    (f"judge-{index}", os.environ[f"JUDGE_{index}_PROVIDER"],
     os.environ[f"JUDGE_{index}_MODEL"], os.environ[f"JUDGE_{index}_URL"])
    for index in range(1, 4)
}
if running != expected:
    raise SystemExit("The evaluator on port 8011 is using different judge settings. Stop it before restarting with new settings.")
print("Datadoom evaluator is already running at http://127.0.0.1:8011.")
PY
    exit 0
fi

exec "$evaluator_python" -m uvicorn ai.main:app --host 127.0.0.1 --port 8011
