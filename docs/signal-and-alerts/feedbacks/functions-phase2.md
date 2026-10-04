# Feedback: `scanin-svc-firebase-functions` — Phase 2 completion: recomputeSmoothing, 90-day backfill, prism TwoD derived (FN-2.2, FN-2.3, FN-2.5)

**Date:** 2026-10-04
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Status:** implemented, build + lint pass, emulator **Phase 2: 16/16** + **Phase 1 regression: 35/35** green, TwoD comparison + both backfill dry-runs done (read-only). **Not deployed, not committed, nothing applied** — pending review (deploy approval hinges on §2).

---

## 1. What changed

| File | Content |
|---|---|
| `src/smoothing.ts` | **FN-2.5** shared prism helpers: `adjustedAxisValue` — the single adjusted-value definition for live + recompute; prism TwoD → `hypot(E − E0, N − N0)` (falls back to raw − initial when the sample lacks E/N); `isTwoDLegacy` — a prism with a TwoD initial but NO E/N initials keeps the old behavior; `smoothingAxes` — prisms also smooth E/N; `derivePrismTwoDSmooth` — `smooth.TwoD = hypot(smooth.E, smooth.N)`, and when E/N smooth is unavailable the biased magnitude average is **deleted**, not published. |
| `src/checkThresholds.ts` | Live evaluator uses `adjustedAxisValue` in both the suspect check and the raw-rule evaluation; prisms smooth E/N (components stored on `smooth` — UI gets them for free) and TwoD is derived; `ref` for TwoD = the derived smooth. Exports `evaluateNewThreshold` / `shouldEvaluateAxis` for reuse. |
| `src/recomputeSmoothing.ts` (new) | **FN-2.2** `recomputeSmoothingCore({sensorId, fromTime, toTime?, apply})`: pages data-log from `fromTime − 24h` (2000/page) with a **sliding in-memory window** (no per-sample window queries); per sample ≥ fromTime the same pure functions as the live evaluator (filterWindow, computeSmooth incl. diurnal coverage, suspect check, TwoD derivation); **piecewise baselines** — adjusted values use the baseline event in force at the sample's time (no events → current initial-value); running `ref` seeded from the last stored smooth before `fromTime`, updated only from non-suspect samples; writes `smooth` / `eval` / evaluator-suspect flags in batches of 400 (updates → `checkThresholds` onCreate never fires); clears evaluator-set suspect flags that now pass; **never clears ingestion flags** (`suspect_reason` ∉ {implausible-jump, out-of-range}); never touches raw fields / alert_state / status / alerts; **never raises data-integrity notices** (would-be suspects are counted and reported). Field diffing is key-order-insensitive (Firestore doesn't preserve map order). Plus the `recomputeSmoothing` **callable** (admin-only — `admin`/`isAdmin`, 1GiB / 540s, always applies). |
| `src/setBaseline.ts` | **Hook**: after resolving notices, `applyBaseline` runs `recomputeSmoothingCore(fromTime = event time, apply: true)`; a recompute failure cannot fail the baseline (caught, reported in the result). Timeout 120→300s, memory 256→512MiB. |
| `src/index.ts` | Exports `recomputeSmoothing`. |
| `scripts/recompute-smoothing.js` (new) | Wrapper, **dry-run by default**, `--apply` to write. Usage: `node scripts/recompute-smoothing.js --sensor=<id> \| --project=<id>[,<id>…] \| --all-active [--days=90] [--apply]`. Scope = active, non-vibration sensors with thresholds. Prints per-sensor stats, per-type totals and estimated read/write cost. |
| `scripts/compare-twod-prisms.js` (new) | Read-only: old vs new adjusted TwoD + resulting level on every prism's latest sample (§2). |
| `scripts/test-phase2-emulator.js` (new) | 16-check acceptance suite (refuses to run without `FIRESTORE_EMULATOR_HOST`). |

---

## 2. TwoD comparison (prod, read-only) — deploy-approval input

325 prisms; **274 comparable** with the new formula. **9 prisms change level on their latest sample:**

| Sensor | Site | old adj (level) | new adj (level) |
|---|---|---|---|
| 982hVQBaXNtK0pCbdRTb "E7" | מגדל דה וינצי דרום | 8.27 (warn) | 1.68 (**ok**) |
| AG6010IORg3UCFmN0r3A "2" | e2NemfiQGhgKTW2FgJtu | 118.56 (alarm) | 2.52 (**ok**) |
| GUEQXlmCVOC2cCZXZhcf "a8" | e39vIWXDt7L0peeTW81q | 5.10 (warn) | 1.85 (**ok**) |
| KDAHpmd6d2cxfx4YNWMz "B9" | מגדל דה וינצי דרום | 8.14 (warn) | 1.19 (**ok**) |
| RRhr8wvLvlCTMv9OKTh6 "B4" | מגדל דה וינצי דרום | 3486.96 (alarm) | 0.83 (**ok**) |
| W5CWaz4bDuEN6sFWjsNI "11" | ge8lO1KCbxU4RnpgL7xs | 756.30 (alarm) | 1.98 (**ok**) |
| sen-Laser-PRISM_JTCS_R2_A2 | 0dVZleFUqyRNfgeqxdSd | 815.27 (alarm) | 0.36 (**ok**) |
| sen-Laser-PRISM_JTCS_R2_D2 | 0dVZleFUqyRNfgeqxdSd | 871.32 (alarm) | 0.50 (**ok**) |
| **sen-prism-prism_JTCS_H2_5D "10"** | JCTS_SAVYON (pUeJ6MlE…) | −7.15 (warn) | **11.42 (alarm)** |

- 8 **false alarms disappear** — the old math subtracted magnitude initials, inventing up to 3,487 mm of displacement.
- 1 prism (**H2_5D**) surfaces as a real **alarm** that the old math was masking — JTCS family, likely related to the known identity errors; see open question 1.
- **37 prisms stay on the legacy behavior** (TwoD initial but no E/N initials): 33 at site `0dVZleFUqyRNfgeqxdSd` ("PRISM%ATS1%R2P*"), 3 `sen-prism-prism_JTCS_H3_*` (TwoD initial = 0), 1 other (`PbqRPpH4nSPNSVyER9pE`). Full list in the comparison script output.
- 0 prisms had samples lacking E/N; 15 have no TwoD thresholds; 14 no data.

Re-runnable anytime: `node scripts/compare-twod-prisms.js` (read-only).

---

## 3. Emulator results

**Phase 2 suite — 16/16 ✅**

| Case | Checks |
|---|---|
| A. TwoD derived | prism with E0=100: derived adjusted = 10 → `eval` **warn** while the old math would say 0.5/ok; `smooth.TwoD == hypot(smooth.E, smooth.N) ≈ 10` (not the biased ≈0.5); E/N components stored on `smooth`; `ref` = derived smooth; legacy prism (TwoD initial only) keeps raw−initial behavior for eval and smooth |
| B. recompute == live | dry-run over a live-evaluated straingage **and** the derived-TwoD prism → `wouldChange = 0` |
| C. baseline crossing | two baseline events (initial 10 → 20): live had evaluated pre-event samples with today's mirror (alarm); recompute re-evaluates them with the event-time baseline → ok, smooth ≈ 0 on both sides, post-event windows exclude pre-event samples |
| D. ingestion flags | `suspect_reason: 'run-common-mode'` doc untouched (flag preserved, no smooth/eval added), counted in `ingestionSuspectsPreserved` |

**Phase 1 regression — 35/35 ✅** (now also exercising the setBaseline → recompute hook).

---

## 4. Backfill dry-runs (90 days, prod, read-only)

| Run | Sensors | Docs read | Would write | Smooth coverage | Would-be suspects | Est. cost |
|---|---|---|---|---|---|---|
| **Pilot** (צייטלין 12 `oBcqejjRiLRIFhG2UzPI` + דה וינצי דרום `hmPh7Hg2fjTc9GyNRDYO`) | 84 | 30,922 | 26,507 | 87.7% | **296** (286 crack, 8 prism, 2 tilt) | $0.02 + $0.05 |
| **All active** (22 projects) | 272 | 168,552 | 138,416 | 94.1% | **1,662** (1,370 prism, 287 crack, 5 tilt) | $0.10 + $0.25 |

Per-type smooth coverage (all-active): crack 98.9%, tilt 96.5%, cracktemp 98.3%, OPKON 96.8–97.4%, battery 99.3%, loadcell 92.7%, **prism 73.0%** — sparse prism windows (4–6 samples/day) fail the min-n / diurnal-coverage rules; strengthens the pending §8.1 decision (48h prism window).

Notes:
- The 1,370 prism would-be suspects concentrate in the known JTCS identity-error history (09-23 era). The backfill would flag them `suspect` **without raising notices** — pre-cleaning exactly the data the BR-R.* repair will handle.
- The 286/287 crack suspects match the known glitchy crack sensors (plan §2: "crack 1 = 16% glitches on a flat signal").
- Full per-sensor dry-run outputs kept locally; re-runnable with the script (read-only).

---

## 5. Deploy plan (after approval of §2) & rollback

1. `firebase deploy --only functions:checkThresholds,functions:setBaseline,functions:recomputeSmoothing` — **before** the backfill, so live evaluation and backfilled history use the same math. No new indexes needed.
2. Backfill (Hillel runs):
   `node scripts/recompute-smoothing.js --project=oBcqejjRiLRIFhG2UzPI,hmPh7Hg2fjTc9GyNRDYO --days=90 --apply` (pilot), then
   `node scripts/recompute-smoothing.js --all-active --days=90 --apply`.
3. **Rollback:** redeploy `26c99a5` — TwoD reverts to the old math, the recompute callable can be deleted; backfilled `smooth`/`eval` fields are inert for old code; backfill-set suspect flags stay but can be re-litigated by a later recompute run.

---

## 6. Open questions

1. **H2_5D (SAVYON_LIVING "10") flips warn → alarm** under the correct math — on deploy its next sample may alert. OK to let it alert, or investigate the prism first (JTCS identity-error family)?
2. The **37 legacy prisms** (no E/N initials): follow-up task to set E/N baselines (via `setBaseline`) so they join the correct math?
3. Confirm deploy-before-backfill ordering (step 1 → 2).
4. **Prism 73% smooth coverage** → take the 48h-prism-window decision (plan §8.1) in the next round?

---

## Handbook review (2026-10-04)

- **TwoD comparison:** approved. 8 false alarms disappear, as expected.
- **H2_5D (SAVYON_LIVING "10")**: its last sample is from 2026-08-29. It has had no data for 37 days, because `h2p5d` writes into "12" (findings §4). So it won't alert on deploy. The 11.42 mm comes from Hexagon-era initials applied to live-era values, which are relative to the station's own first sample. That's the Hexagon→live cutover baseline problem (findings §7.3, BR-R.2), parked with the ATS work. It affects all live-mapped JTCS prisms under both the old and the new math.
- **37 legacy prisms** (TwoD initial, no E/N initials): leave them as they are. Fix them with the ATS repair work, after asking Nathan where their E/N zero is. Don't use `setBaseline` for this, because it would move their zero.
- **Order:** deploy before backfill, confirmed.
- **Prism window: decided 48h** (plan §8.1). It also cancels the diurnal cycle (two whole days). Coverage quarters are bucketed by `((t − windowStart) mod 24h) / 6h`. Other types stay at 24h. Implement it before the deploy, then re-run the dry-runs.
