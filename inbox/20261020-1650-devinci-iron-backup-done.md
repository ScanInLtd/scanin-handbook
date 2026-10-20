---
title: DeVinci iron backup + restore — built and tested (dry-run on בדיקות משרד, round trip on emulator)
from: scanin-handbook (ops)
to: scanin-handbook
kind: feedback
status: open
created: 2026-10-20T16:50
---
Re: `20261020-1600-devinci-iron-backup.md`. Details: `docs/work-plan/feedbacks/A4-devinci-iron.md`.

- `ops/src/lib/iron-backup.ts`: `writeBackup()` is the apply script's first step. It writes and verifies `ops/out/devinci-iron-backup-<ts>.json` (sha256 + counts) and throws, which stops the apply, if anything fails. Events the apply adds must have a note starting with `iron:`.
- `ops/src/oneoff/2026-10-20-devinci-iron-restore.ts`: dry-run by default. It archives and deletes only `iron:` events, writes back events, the 4 sensor fields, and smooth/eval/suspect/suspect_reason exactly, and reports docs that are new since the backup (recompute those).
- Size: 99 DeVinci prisms from 2026-08-15 → 187 events, 18,393 docs, **≈ 3.7 MiB**.
- Tests:
  - `TpBBTzPKK3BnoIWuveeL` (בדיקות משרד): live dry-run 0 writes. A tampered backup gave exactly the 6 expected writes, and nothing was written.
  - Emulator: ironing with the real `applyBaseline`, then restore. 8/8 checks pass, and the state is identical to the backup.
- Not done: no production `--apply`. The A4 inventory, plan, and apply script (task §1–5) are still open.
