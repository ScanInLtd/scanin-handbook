---
title: Maccabi Yafo demo to 15.10.26 with ~3 mm settlement — build --trend/--tag, dry-run only
from: scanin-handbook
to: scanin-tool-data-replay
kind: task
status: open
created: 2026-10-20T15:40
---
Context: the Maccabi Yafo site (`e39vIWXDt7L0peeTW81q`) is a demo site; all its data is generated with the gap-fill runbook in this repo. Report REP136 (group R11–R15) must now cover the site's start → **2026-10-15**, look like real data, and show **≈ 3 mm settlement** (Height). Today the generated data ends 2026-09-23, is flat (±2 mm rule), and is tagged `isReplay`. The MA (`smooth`) deliberately skips `isReplay` samples, so a report on it has no main line. Full spec: `../scanin-handbook/docs/work-plan/tasks/B2-maccabi-demo.md`.

Assignment:
- Do **steps 1–4** of the spec:
  - `--trend=<axis>:<mm>` and `--tag=worked|replay` in `gap-fill.js`; trend-aware `gap-verify.js`;
  - gap-report;
  - backup (`gap-backup.js`);
  - **dry-run** for R11–R15 to 2026-10-15T23:59 with `--trend=HeightDisplacement:-3 --tag=worked`.
- **Tag decision (approved by Hillel):** generated docs get `isWorked: true, source: 'worked'` instead of `isReplay`.
- This folder has **no git**: copy `gap-fill.js`, `gap-verify.js` and `lib/gapfill.js` to `*.bak-2026-10-20` before editing.
- Do **NOT** `--apply` the fill, do **NOT** run `recompute-smoothing --apply`, do **NOT** trigger the real report (it emails). Only R11–R15 of this project; never touch untagged docs.

Done when: the dry-run report is ready. Per prism:
- slots to write, docs to replace;
- simulated Height start → end (target ≈ −3 mm);
- max day-to-day jump on the detrended series;
- E/N spans;
- plus a small chart of simulated Height for the 5 prisms.

Write it to `../scanin-handbook/docs/work-plan/feedbacks/B2-maccabi-demo.md`, then send a `kind: feedback` message to `user` in `../scanin-handbook/inbox/` and stop for approval. Steps 5–9 (apply, MA backfill, verify, local PDF render, runbook update) come after Hillel approves.
