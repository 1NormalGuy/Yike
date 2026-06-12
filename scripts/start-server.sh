#!/usr/bin/env bash

set -euo pipefail

PORT="${1:-8086}"
HOST="0.0.0.0"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="/tmp/jyk_birthday_${PORT}.pid"
LOG_FILE="/tmp/jyk_birthday_${PORT}.log"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Server is already running (PID $EXISTING_PID)."
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use."
  exit 1
fi

nohup python3 -m http.server "$PORT" \
  --bind "$HOST" \
  --directory "$ROOT_DIR" \
  >"$LOG_FILE" 2>&1 &

SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"
sleep 0.5

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "Server failed to start. See $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi

LOCAL_IP="$(
  ipconfig getifaddr en0 2>/dev/null \
  || ipconfig getifaddr en1 2>/dev/null \
  || hostname -I 2>/dev/null | awk '{print $1}' \
  || true
)"

echo "Server started in background (PID $SERVER_PID)."
echo "Local:   http://127.0.0.1:$PORT"
if [[ -n "$LOCAL_IP" ]]; then
  echo "LAN:     http://$LOCAL_IP:$PORT"
fi
echo "Log:     $LOG_FILE"
echo "Stop:    ./scripts/stop-server.sh $PORT"
