#!/bin/bash
# ScanIn shim: pins the firebase-tools account (firebase-tools ignores CLOUDSDK_CONFIG).
# Loaded via PATH_add in ~/dev/clients/scanin/.envrc. Login commands pass through unchanged.
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL="$(PATH="$(echo "$PATH" | tr ':' '\n' | grep -vx "$SELF_DIR" | paste -sd: -)" command -v firebase)"
[ -z "$REAL" ] && { echo "firebase CLI not found" >&2; exit 127; }
case "$1" in login|login:*|logout) exec "$REAL" "$@";; esac
exec "$REAL" --account "${REPO_GCP_ACCOUNT:-scanin.link@gmail.com}" "$@"
