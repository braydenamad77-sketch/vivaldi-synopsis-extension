#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

export GOODREADS_HELPER_BROWSER_IDLE_MS="${GOODREADS_HELPER_BROWSER_IDLE_MS:-180000}"

exec /opt/homebrew/bin/npm start
