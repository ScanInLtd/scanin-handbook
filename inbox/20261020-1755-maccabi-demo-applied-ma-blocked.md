---
title: B2 Maccabi demo — data applied + verified; MA blocked on R11–R15 thresholds (config decision)
from: scanin-tool-data-replay
to: user
kind: feedback
status: open
created: 2026-10-20T17:55
---
Applied as approved. Details: `docs/work-plan/feedbacks/B2-maccabi-demo.md` (§Update).

Done:
- **Fill:** 3,187 docs written (`isWorked`), 2,268 `isReplay` replaced, 460 retagged.
- **Daily rebuild:** done.
- **Verify:** 5/5 PASS. Height Δ: R11 −3.01, R12 −2.97, R13 −3.38, R14 −3.34, R15 −2.77 mm.
- **Runbook:** updated.

**Blocked: the MA.** The recompute ran, but R11–R15 have thresholds only on `daily*` axes. `smooth` is only computed for alerting raw axes (Height/Easting/Northing), so REP136 would show "אין ממוצע".

Need a yes/no:
1. Add Height/Easting/Northing thresholds (warn 5 / alarm 7, same as their daily axes and as a3) to R11–R15, then re-run the MA recompute and render the PDF locally?
2. Also do the rest of the site (a3/a4/a7/a8 retag `isReplay` → `isWorked`; R1–R10 thresholds)? This is outside B2's scope.
