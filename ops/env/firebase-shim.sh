#!/bin/bash
# ScanIn shim: pins the firebase-tools account (firebase-tools ignores CLOUDSDK_CONFIG).
# Loaded via PATH_add in ~/dev/clients/scanin/.envrc. Login commands pass through unchanged.
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL="$(PATH="$(echo "$PATH" | tr ':' '\n' | grep -vx "$SELF_DIR" | paste -sd: -)" command -v firebase)"
# No firebase on PATH (e.g. nvm default points at nothing): use the nvm Node 20 install, which the
# ScanIn deploy scripts expect (firebase-tools needs Node ≥ 20). Its node goes first on PATH.
if [ -z "$REAL" ]; then
  for c in "$HOME"/.nvm/versions/node/v20.*/bin/firebase; do [ -x "$c" ] && REAL="$c"; done
  [ -n "$REAL" ] && export PATH="$(dirname "$REAL"):$PATH"
fi
[ -z "$REAL" ] && { echo "firebase CLI not found (install: nvm install 20 && npm i -g firebase-tools)" >&2; exit 127; }
case "$1" in login|login:*|logout) exec "$REAL" "$@";; esac
exec "$REAL" --account "${SCANIN_GCP_ACCOUNT:-scanin.link@gmail.com}" "$@"
