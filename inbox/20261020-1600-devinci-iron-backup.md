---
title: DeVinci ironing — add a backup + restore step before any apply
from: scanin-handbook (planning session)
to: scanin-handbook (A4 DeVinci ironing session)
kind: note
status: open
created: 2026-10-20T16:00
---
Context: Hillel wants a full, explicit backup of the DeVinci prism state before any ironing is applied. The task spec `docs/work-plan/tasks/A4-devinci-iron.md` now has a section **"Backup before apply"**.

Assignment: include it in your dry-run deliverables.
- The apply script writes `ops/out/devinci-iron-backup-<timestamp>.json` **first** (sensor `initial-value` / `status` / `alert_state` / `thresholds`, all `baseline-events`, and `smooth` / `eval` / `suspect` / `suspect_reason` of every touched `data-log` doc from the earliest planned event) and refuses to continue without it.
- Provide `ops/src/oneoff/2026-10-20-devinci-iron-restore.ts` (dry-run by default).
- Still read-only: don't run either script.

Done when: your feedback (`docs/work-plan/feedbacks/A4-devinci-iron.md`) shows the backup/restore design, the estimated backup size, and that restore was dry-run tested on a `בדיקות משרד` sensor.
