#!/usr/bin/env bash
# Start vLLM detached and block until it answers /v1/models, or report failure.
#
#   bash scripts/serve-bg.sh                       # base model, prints READY or FAILED/TIMEOUT
#   bash scripts/serve-bg.sh <model> [vllm flags]  # anything serve.sh accepts
#   bash scripts/serve-bg.sh --stop                # stop the server
#   bash scripts/serve-bg.sh --status              # is it answering?
#
# The server log is ~/vllm.log. Eval scripts call this first so they never
# race the model load. Exit codes: 0 ready, 1 failed or timed out.
set -uo pipefail
LOG="$HOME/vllm.log"
PORT="${VLLM_PORT:-8000}"
KEY="${VLLM_API_KEY:-dev}"
URL="http://127.0.0.1:$PORT/v1/models"
HERE="$(cd "$(dirname "$0")" && pwd)"

probe() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$URL" 2>/dev/null || true; }

case "${1:-}" in
  --stop)
    pkill -f 'vllm serve' 2>/dev/null && echo STOPPED || echo "nothing running"
    pkill -f 'VLLM::EngineCore' 2>/dev/null || true
    exit 0 ;;
  --status)
    code=$(probe); echo "http $code"; [[ "$code" == "200" ]] ;;
esac
[[ "${1:-}" == "--status" ]] && exit $?

if [[ "$(probe)" == "200" ]]; then
  echo "already running"; echo READY; exit 0
fi

: > "$LOG"
setsid nohup bash "$HERE/serve.sh" "$@" >> "$LOG" 2>&1 < /dev/null &
echo "started vllm serve ${1:-Qwen/Qwen3-4B-Instruct-2507}, log $LOG"

for _ in $(seq 1 120); do          # up to 10 minutes; first start compiles graphs
  sleep 5
  if [[ "$(probe)" == "200" ]]; then
    echo READY
    curl -s -H "Authorization: Bearer $KEY" "$URL"; echo
    exit 0
  fi
  if grep -q Traceback "$LOG" || ! pgrep -f 'vllm serve' >/dev/null; then
    echo FAILED; tail -n 40 "$LOG"; exit 1
  fi
done
echo TIMEOUT; tail -n 20 "$LOG"; exit 1
