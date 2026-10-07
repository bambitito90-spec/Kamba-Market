#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/backups}"
mkdir -p "$DEST"
STAMP="$(date +%Y%m%d_%H%M%S)"
tar -czf "$DEST/kamba_json_$STAMP.tgz" -C "$ROOT" data public/uploads
printf 'Backup criado: %s\n' "$DEST/kamba_json_$STAMP.tgz"
