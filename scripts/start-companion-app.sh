#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/app"
LOG_DIR="$HOME/Library/Logs/Vivaldi Synopsis Companion"
HEALTH_URL="http://127.0.0.1:4317/health"
ELECTRON_BIN="$APP_DIR/node_modules/.bin/electron"

mkdir -p "$LOG_DIR"

if curl -fsS --max-time 1 "$HEALTH_URL" >/dev/null 2>&1; then
  exit 0
fi

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Electron launcher not found at $ELECTRON_BIN" >&2
  exit 1
fi

nohup "$ELECTRON_BIN" "$APP_DIR" >>"$LOG_DIR/app.log" 2>&1 &
