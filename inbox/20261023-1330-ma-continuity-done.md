---
title: MA continuity events — implemented, deployed, DeVinci recomputed
from: scanin-svc-firebase-functions
to: user
kind: feedback
status: open
created: 2026-10-23T13:30
---

Done: `20261023-1240-ma-continuity-events.md`. `continuity: true` / `reason:"iron"` baseline events no longer cut the MA window — each window sample is adjusted with the baseline in force at its own time, resets still cut.

**Commit:** `3f564a3` `smoothing: baseline continuity events span the MA window (iron/rebaseline)` — pushed to `origin/master` together with the two ref-lock commits (`71cdde1`, `5283676`).

**Changes:** `smoothing.ts` (`isContinuityBaseline`, `makeBaselineResolver` — `initialAt(t)` + `resetBefore(t)`; `computeSmooth` per-sample initials; `filterWindow` cuts only at reset events), `recomputeSmoothing` (resolver in main pass + re-seed pre-scan; suspect/ref checks on adjusted values — no re-seed or suspect from the event itself), `checkThresholds` (live path uses the same resolver; the trigger sample evaluates against the baseline in force at its own time), `setBaseline` (`"iron"` added to `BASELINE_REASONS`, stamped `continuity:true`; `initial-value` now mirrors the *latest* event by time — backdated events no longer leave a stale mirror).

**Tests (all green):** new `test-continuity-baseline-emulator.js` (continuity spans a +10mm step, smooth continuous + no gap + no suspect/reseed, `iron` reason identical without the flag, plain reset still cuts, mixed reset+continuity, live `analyzeSample` path, second-run `wouldChange=0`). Phase-2 ×21, ref-reseed ×16, delete-baseline ×28 all pass. Phase-2 Case C updated to the new piecewise semantics (live now matches recompute — `wouldChange=0`), and the suite now pins `GOOGLE_CLOUD_PROJECT` — previously live-trigger checks were silently vacuous (writes landed in the wrong emulator project namespace).

**Deploy:** `checkThresholds`, `recomputeSmoothing`, `setBaseline`, `deleteBaseline`, `restoreBaseline` — deployed to `dataloggerdev` ~10:16Z, 5/5 successful.

**Recompute (DeVinci only):** `recompute-smoothing.js --project=hmPh7Hg2fjTc9GyNRDYO --days=all --type=prism --apply` — 99 sensors, 12,890 samples processed, 2,147 writes, ~$0.03. No fleet `--apply`. Confirmation dry-run afterwards: `wouldChange=0` on all 99 sensors.

**Coverage before → after** (`smooth-daily.ts`, smooth% of clean samples):

| day | before | after | note |
|---|---|---|---|
| 2026-10-07 | 84% | 98% | ironing recovered |
| 2026-10-08 | 67% | 98% | ironing day — recovered |
| 2026-10-09 | 71% | 96% | ironing day — recovered |
| 2026-10-14 | 27% | 29% | see caveat |
| 2026-10-15 | 81% | 88% | recovering |
| 2026-10-16 | 49% | 86% | ironing day — recovered |
| 2026-10-19 | 68% | 68% | see caveat |
| 2026-09-30 / 10-01 | 0% | 0% | real outage — expected |

**Caveat — 10-14 and 10-19 are *not* event-related:** the site had a ~58h data gap (only 28 of ~75 prisms reported on 10-12/10-13). Samples on 10-14/10-19 sit in 48h windows that are simply empty or thin (verified per-sensor: f5p11 resumed 10-14T07:12 after 58h silent; f12p11 gap 10-17→10-19). The MA can't cover missing data — windows refill as samples accumulate (10-15 already at 88%). Also note `uXZzXVc5VhjnE5Z9GtpV` is a `tilt` doc with no thresholds that smooth-daily counts in the denominator — noise, not a regression.

Ref/suspect correctness held: only chain-start ref seeds logged (one per axis per sensor's first sample), zero suspects created by the continuity events themselves; the 16 remaining suspects are pre-existing ingestion flags.
