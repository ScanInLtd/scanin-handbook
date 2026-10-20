# Feedback — FN-recompute-ref-lock (functions)

**Task:** [`work-plan/tasks/FN-recompute-ref-lock.md`](../../work-plan/tasks/FN-recompute-ref-lock.md)
**Repo:** `scanin-svc-firebase-functions`, commit `71cdde1` on `master` (**not pushed, not deployed, no `--apply` run**)
**Date:** 2026-10-20

## What changed

`src/recomputeSmoothing.ts`, `recomputeSmoothingCore`:

- **Read-only pre-scan** over `[fromTime, toTime]` before the main pass. It simulates the running per-axis `ref` and emits **re-seeds**:
  - **Mid-history step:** the axis violates `jump` continuously for **≥ 2 × the smoothing window**, and the largest agreeing block of the last 2 windows (spread ≤ `jump/2`) holds **≥ 4 samples and ≥ 60%** of them. Then `ref` = the block median, applied from the first violating sample. Outliers inside the run fall outside the block instead of resetting it.
  - **Chain start (no seeded ref):** the first stable 2-window era seeds `ref`, not the first window. Earlier inconsistent samples (install junk) are still flagged `implausible-jump` in the main pass.
- **Main pass** applies the queued re-seeds before each sample's suspect check. While the smoothing window still reaches back across the step (`applyFrom + window`), `ref` is not overwritten from `smooth`, because that smooth is still dominated by the old level and would lock the chain again. Recovered samples get `smooth`/`eval` in the same pass, and stale evaluator flags on them are cleared.
- **Ingestion suspects** (any `suspect_reason` outside `implausible-jump`/`out-of-range`) are skipped by both passes and are never cleared. Out-of-range samples neither join nor break a run. `noSuspectAxes` (releaseSuspect) is exempt.
- **Stats:** `refReseeds: [{ axis, applyFrom, atTime, ref, runSamples, chainStart }]`, also logged per sensor.
- **Live evaluator: unchanged.** It still raises the data-integrity notice for human review.
- Side effect: `docsRead` now counts both passes. A full-history recompute reads the range about twice: JAFFA_68 all-history is 245k reads ≈ $0.15, and the fleet prism 365d run is 354k reads ≈ $0.21.

`scripts/recompute-smoothing.js`: per-sensor `RESEEDS=n`. The summary splits **mid-history steps, which need a baseline event** (with the sensor count) from chain-start seeds, which are informational.

## Tests

`scripts/test-ref-reseed-emulator.js` (Firestore emulator, calls the core directly, wipes its sensors so re-runs are deterministic): **16/16 passed**

- A. junk-then-calm: one chain-start seed ≈ calm level, all 12 junk samples flagged, calm era not suspect, smoothed, eval ok, and the ingestion suspect preserved
- B. real step (0.05 → 8, no event): exactly one step re-seed ≈ 8 at the step, post-step era smoothed with no suspects, smooth ≈ 8
- C. isolated spikes stay suspect and trigger no re-seed. A stale evaluator flag on a consistent sample is cleared.
- D. second dry-run gives `wouldChange = 0` on all three sensors

Regression: `test-delete-baseline-emulator.js` still **28/28**. `npm run build` is clean. Lint has 0 errors; the 3 warnings are old ones in `setup-notification-config.ts`.

Smoothing still needs ≥ 3 of the 4 six-hour quarters, so the first few samples of every era have no `smooth`. That is expected, not a gap left by this change.

## Dry-runs (read-only)

### JAFFA_68 `--project=e2NemfiQGhgKTW2FgJtu --days=all`

| | before (task baseline) | now |
|---|---|---|
| prism suspects | ~2,191 of ~2,600 on a single prism | **404 across all 9 prisms** |
| prism smooth coverage | — | 91.4% |
| wouldChange | — | 7,586 (prism), 0 (tilt) |

Mid-history steps (need a baseline event):

| sensor | axis | step | new level |
|---|---|---|---|
| "1" `xmXaS7p7cjlRTkoRZhrs` | E, H | 2026-02-09 | back to ~0 (H was ~+1,832 mm since Dec 2025). This is the step named in the task. |
| "2" `AG6010IORg3UCFmN0r3A` | E, H | 2026-02-09 | back to ~0 (H was ~−1,828 mm since Mar 2025) |
| "6" `1E6nK59E5xWEAXKE4Lmv` | H | 2026-08-10 | **+3,055 mm** |
| "8" `lCzOkCIT88VwrLQPMAkM` | H, N | 2026-10-08 | **H +3,622 / N +231 mm** |
| "3" `p8lLBLV4G5UPqZWE2f95` | H | 2026-10-12 | ~0 (minor) |

All prisms also get a chain-start seed (Mar–Dec 2025), and so do both tilts (May 2024).

### Fleet `--all-active --days=365 --type=prism`

211 prisms, 1.2 min. 100,894 samples, smooth 87.8%, 2,546 suspects, wouldChange 73,933. There are 146 re-seeds; **45 of them are mid-history steps on 13 sensors**:

| sensor | name | step(s) | magnitude | verdict |
|---|---|---|---|---|
| `1E6nK59E5xWEAXKE4Lmv` | "6" (JAFFA_68) | 2026-08-10 H | +3,055 | **needs event** |
| `lCzOkCIT88VwrLQPMAkM` | "8" (JAFFA_68) | 2026-10-08 H/N | +3,622 / +231 | **needs event** |
| `xmXaS7p7cjlRTkoRZhrs` | "1" (JAFFA_68) | 2026-02-09 E/H | back to 0 | **needs event** (the earlier offset) |
| `0wD0jDKhIH4wJk1s6G8v` | "7" | 2026-10-11 H | −2,721 | **needs event** |
| `XnYw2FlxUawGpur9qXba` | "9" | 2026-08-09 H | −1,290 | **needs event** |
| `sen-prism-PRISM_JTCS_H0_12A` | "23" | 07-08 E/N, 08-08 E/H/N, 08-26 back to ~0 | ±8,600 / −2,666 | **needs events** (looks like a target swap/mapping) |
| `sen-prism-PRISM_JTCS_H0_12B` | "24" | 02-09 (minor), 08-26 E/H/N | −8,825 / −2,737 / −2,774 | **needs event** |
| `sen-prism-PRISM_JTCS_H0_9B` | "18" | 02-18 (minor), 08-26 H | −2,471 | **needs event** |
| `sen-prism-prism_JTCS_H2_3F` | "3" | 07-29 (minor), 08-10 E/H/N, 09-08 back to ~0 | +8,873 / +2,717 | **needs events** |
| `7mqLg96n468ocH0AGeUo` | "f11p9" | 10-06 E/H/N, 10-14 back to ~0 | +7,513 N / −1,535 H | **needs events** |
| `W5CWaz4bDuEN6sFWjsNI` | "11" | 2026-07-22 | < 1 mm | drift; no event |
| `sen-prism-prism_JTCS_H0_7B` | "14" | 2026-04-05 | ~1 mm | drift; no event |
| `p8lLBLV4G5UPqZWE2f95` | "3" (JAFFA_68) | 2026-10-12 H | ~0 | drift; no event |

The H0_* "back to ~0" re-seeds on 08-26 and 09-08 line up with ATS rebaseline/mapping work. Check against `ats-setup`/`mapping-fix` events before adding new ones.

## Important before anyone runs `--apply`

A re-seed **makes a step era smooth and evaluable** instead of suspect. For the large steps (thousands of mm) that era then shows `smooth` ≈ the offset and `eval` = **alarm**, instead of being flagged suspect. This is honest about the raw data, but it will look like real movement on charts and reports. **Add the baseline events (A3 UI / `setBaseline`) for the "needs event" rows first, then apply.** The baseline event makes those eras ≈ 0, and the re-seeds go away on the next dry-run.

Suggested order: (1) Nathan confirms the steps above, (2) add events, (3) re-run the dry-run until only chain-start and drift re-seeds remain, (4) `--apply` JAFFA_68 `--days=all`, then the fleet.

## Not done (by instruction)

- No deploy. The callable `recomputeSmoothing`, `setBaseline`, and `deleteBaseline` all pick up the new core on the next functions deploy. Only historical recompute behavior changes.
- No `--apply`. Checkpoint files: `scripts/.recompute-checkpoint-reflock-jaffa68-all.jsonl`, `…-reflock-fleet-prism-365.jsonl` (gitignored).
- Not pushed.
