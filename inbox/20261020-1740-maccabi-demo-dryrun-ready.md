---
title: B2 Maccabi Yafo demo — dry run ready, approval needed before --apply
from: scanin-tool-data-replay
to: user
kind: feedback
status: open
created: 2026-10-20T17:40
---
Steps 1–4 of `docs/work-plan/tasks/B2-maccabi-demo.md` are done. **Nothing written to Firestore.**

Full report + chart: `docs/work-plan/feedbacks/B2-maccabi-demo.md` (chart: `B2-maccabi-demo-height.png`).

- `--trend` / `--tag=worked` built in `gap-fill.js`; `gap-verify.js` is trend-aware. Backup: 4,948 docs → `scanin-tool-data-replay/backups/_101-2026-10-20T14-32-51-854Z/`.
- Dry run R11–R15 → 2026-10-15T23:59. Height Δ (site first-14d → last-14d): R11 −3.01, R12 −2.97, R13 −3.38, R14 −3.34, R15 −2.77 mm. Max detrended day-to-day jump ≤ 1.48 mm on all axes.
- Docs per prism: R11/R12/R13/R14/R15 write 391/689/799/801/507 and replace 259/562/502/571/374.

**Please approve or adjust these 5 points** (details in the report §"Decisions needed"):
1. `--trend-ref=site`. Spec-literal `baseline` gives R11 −2.01, which fails verify.
2. `--trend-shape=ease-out`.
3. `--source-detrend --wrap=mirror`. Without it, R13/R14 show a 15-day sawtooth.
4. `--max-dev=1.2` for R13/R14.
5. `--retag-prior`. This retags 460 older `isReplay` docs on R11/R12/R15 to `isWorked`, values unchanged. They sit before the last untagged sample; left as is, the MA keeps holes there.

Also: after `--apply`, I suggest running the daily rebuild (runbook step 4) along with the MA recompute.
