#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${SOURCE_DIR:-/home/ubuntu/src/mev/My-Jogyo/src/agent}"
TARGET_DIR="${TARGET_DIR:-/home/ubuntu/.config/opencode/agent}"
SYNC_SCRIPT="${SYNC_SCRIPT:-/home/ubuntu/src/mev/My-Jogyo/scripts/sync_opencode_agents.sh}"
POLL_INTERVAL_SECS="${POLL_INTERVAL_SECS:-2}"

if [[ ! -x "$SYNC_SCRIPT" ]]; then
  echo "ERROR: sync script not executable: $SYNC_SCRIPT" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "ERROR: source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

sync_once() {
  SOURCE_DIR="$SOURCE_DIR" TARGET_DIR="$TARGET_DIR" "$SYNC_SCRIPT"
}

compute_hash() {
  find "$SOURCE_DIR" -type f -print0 \
    | sort -z \
    | xargs -0 -r sha256sum 2>/dev/null \
    | sha256sum \
    | awk '{print $1}'
}

sync_once
last_hash="$(compute_hash)"

while true; do
  current_hash="$(compute_hash)"
  if [[ "$current_hash" != "$last_hash" ]]; then
    sync_once
    last_hash="$current_hash"
  fi
  sleep "$POLL_INTERVAL_SECS"
done
