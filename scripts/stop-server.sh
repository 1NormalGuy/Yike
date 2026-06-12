#!/usr/bin/env bash

set -euo pipefail

PORT="${1:-8086}"
PID_FILE="/tmp/jyk_birthday_${PORT}.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No managed server found for port $PORT."
  exit 0
fi

SERVER_PID="$(cat "$PID_FILE")"
if kill -0 "$SERVER_PID" 2>/dev/null; then
  kill "$SERVER_PID"
  echo "Server stopped (PID $SERVER_PID)."
else
  echo "Server process $SERVER_PID is no longer running."
fi

rm -f "$PID_FILE"
