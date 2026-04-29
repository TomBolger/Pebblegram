#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${PEBBLEGRAM_DIR:-/home/thomas/pebble/Pebblegram}"
HOST="${PEBBLEGRAM_HOST:-0.0.0.0}"
PORT="${PEBBLEGRAM_PORT:-8766}"
MODE="${PEBBLEGRAM_MODE:-telegram}"
LOG_DIR="${PEBBLEGRAM_LOG_DIR:-/tmp}"
BRIDGE_LOG="${LOG_DIR}/pebblegram-bridge.log"
NGROK_LOG="${LOG_DIR}/pebblegram-ngrok.log"

cd "${APP_DIR}"

if [[ -f data/telegram.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source data/telegram.env
  set +a
fi

if [[ "${MODE}" == "telegram" ]]; then
  : "${TELEGRAM_API_ID:?Set TELEGRAM_API_ID or create ${APP_DIR}/data/telegram.env}"
  : "${TELEGRAM_API_HASH:?Set TELEGRAM_API_HASH or create ${APP_DIR}/data/telegram.env}"
  : "${TELEGRAM_PHONE:?Set TELEGRAM_PHONE or create ${APP_DIR}/data/telegram.env}"
fi

if ! pgrep -f "tools/bridge.py --mode ${MODE} --host ${HOST} --port ${PORT}" >/dev/null; then
  setsid env \
    TELEGRAM_API_ID="${TELEGRAM_API_ID:-}" \
    TELEGRAM_API_HASH="${TELEGRAM_API_HASH:-}" \
    TELEGRAM_PHONE="${TELEGRAM_PHONE:-}" \
    TELEGRAM_SESSION="${TELEGRAM_SESSION:-pebblegram}" \
    TELEGRAM_ALLOW_READ_CONTENT="${TELEGRAM_ALLOW_READ_CONTENT:-1}" \
    TELEGRAM_ALLOW_SEND="${TELEGRAM_ALLOW_SEND:-1}" \
    TELEGRAM_ALLOW_DELETE="${TELEGRAM_ALLOW_DELETE:-0}" \
    PEBBLEGRAM_TOKEN="${PEBBLEGRAM_TOKEN:-}" \
    .venv/bin/python tools/bridge.py --mode "${MODE}" --host "${HOST}" --port "${PORT}" \
    > "${BRIDGE_LOG}" 2>&1 &
  echo "Started Pebblegram bridge on ${HOST}:${PORT}; log: ${BRIDGE_LOG}"
else
  echo "Pebblegram bridge already appears to be running; log: ${BRIDGE_LOG}"
fi

if ! pgrep -f "bin/ngrok http ${PORT}" >/dev/null; then
  setsid bin/ngrok http "${PORT}" --config data/ngrok.yml --log=stdout > "${NGROK_LOG}" 2>&1 &
  echo "Started ngrok for port ${PORT}; log: ${NGROK_LOG}"
else
  echo "ngrok already appears to be running; log: ${NGROK_LOG}"
fi

for _ in 1 2 3 4 5 6 7 8 9 10; do
  PUBLIC_URL="$(
    curl -fsS http://127.0.0.1:4040/api/tunnels 2>/dev/null |
      python3 -c 'import json,sys; data=json.load(sys.stdin); urls=[t["public_url"] for t in data.get("tunnels", []) if t.get("proto") == "https"]; print(urls[0] if urls else "")' 2>/dev/null || true
  )"
  if [[ -n "${PUBLIC_URL}" ]]; then
    echo "Public bridge URL: ${PUBLIC_URL}"
    echo "Settings page: ${PUBLIC_URL}/config.html"
    exit 0
  fi
  sleep 1
done

echo "Bridge/ngrok launched, but the ngrok API did not return a public URL yet."
echo "Check ${NGROK_LOG}"
