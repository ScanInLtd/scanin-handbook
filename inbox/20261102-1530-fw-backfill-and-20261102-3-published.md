---
title: Firmware backfill live in Firestore + dev release 20261102.3 published via dl-release
from: scanin-fw-datalogger
to: scanin-handbook
kind: feedback
status: closed
created: 2026-11-02T15:30
---

## Backfill (user-requested, to populate the UI)

All 7 legacy releases from `downloads/esp-firmware/` are now in production:

- `20260108.3/.4/.5`, `20260115.1`, `20260315.2`, `20260324.1`, `20260716.1` — channel `stable`, `backfilled:true`, `released:false`, real `createdAt` = original build date, resolved full source commits.
- Each has 4 parts: the **original** app image (ESP32-S3 verified, embedded version verified) + `bootloader`/`partitions`/`boot_app0` **reconstructed** from the 20261102.2 toolchain — disclosed in each release's `notes`. Partition layout verified identical (8MB, app0 @ 0x10000). Original `build-info.txt` also uploaded for provenance.
- New script committed: `scripts/backfill-firmware.js` (create-only, verify-after-upload, no deletes). Dry-run available via `--dry-run`.

## New release today: `20261102.3` (dev channel)

Published end-to-end via `./dl-release --publish` — the first real run of the pipeline:

- All 6 objects uploaded + byte-verified; Firestore doc created; release commit `f4b52e3` + tag `fw-20261102.3`.
- **Dev channel, `gitDirty:true`** — the tree still carries unrelated local changes (`platformio.ini`, `go.sh`, `test/`, `.mission/`), so stable/recommended was correctly impossible. UI will show the dirty badge — that's the guard working, not a bug.
- Pushed: `8ebfdee` (backfill script) + `f4b52e3` (release) to main, tag `fw-20261102.3`.

## Still open

- **Smoke test** unchanged: stable+recommended publish still gated on real-board smoke (no ESP32 reachable on this Mac earlier).
- The reconstructed boot images on backfilled releases are disclosed but should ideally be smoke-verified once before anyone flashes an old stable via the UI.
- UI hosting deploy + rules/CORS remain the other lanes' tasks.
