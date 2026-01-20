#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${SOURCE_DIR:-/home/ubuntu/src/mev/My-Jogyo/src/agent}"
TARGET_DIR="${TARGET_DIR:-/home/ubuntu/.config/opencode/agent}"
RSYNC_BIN="${RSYNC_BIN:-rsync}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat << 'USAGE'
Usage: sync_opencode_agents.sh

Environment variables:
  SOURCE_DIR  Source agent directory (default: /home/ubuntu/src/mev/My-Jogyo/src/agent)
  TARGET_DIR  Target opencode agent directory (default: /home/ubuntu/.config/opencode/agent)
  RSYNC_BIN   rsync binary path (default: rsync)
USAGE
  exit 0
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "ERROR: source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

if ! command -v "$RSYNC_BIN" >/dev/null 2>&1; then
  echo "ERROR: rsync not found (RSYNC_BIN=$RSYNC_BIN)" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

"$RSYNC_BIN" -a --delete "$SOURCE_DIR"/ "$TARGET_DIR"/
