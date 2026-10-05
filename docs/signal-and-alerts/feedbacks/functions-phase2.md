# Feedback: `scanin-svc-firebase-functions` — Phase 2 completion: recomputeSmoothing, 90-day backfill, prism TwoD derived (FN-2.2, FN-2.3, FN-2.5)

**Date:** 2026-10-04
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Status:** ✅ reviewed & approved (with the 48h-prism-window change — §7), committed **`ec335e3`** + **`96e9737`** + **`8d3cc99`**, **deployed to prod 2026-10-04 16:55 UTC**, emulator **Phase 2: 22/22** + **Phase 1 regression: 35/35** + **batch tooling: 9/9** green. **90-day backfill APPLIED** (pilot + all-active, §9). Pending: full-history fill (scheduled by Hillel, §9.3), detectLevelShifts first-run report (§9.4).

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

## 6. Open questions (answered — review 2026-10-04)

1. **H2_5D (SAVYON_LIVING "10") flips warn → alarm:** no action. Its last sample is 2026-08-29 (h2p5d writes into "12"), so it won't alert. The 11.42 mm comes from Hexagon-era initials applied to live-era values — the Hexagon→live cutover baseline problem, parked with the ATS repair work (BR-R.2).
2. The **37 legacy prisms:** leave on old behavior — they'll be fixed with the ATS repair work. Do **not** call `setBaseline` on them (it would move their zero).
3. Deploy-before-backfill ordering: confirmed.
4. Prism window: **decided 48h** (plan §8.1) — implemented before deploy, see §7.

---

## 7. Review change implemented: 48h smoothing window for prisms

- **Window length per type** via one constant map (`windowMsForType` in `smoothing.ts`): **prism = 48h, everything else = 24h**. Used consistently by the live window query, recompute's paging + sliding window, and min-n.
- **min n** = max(3, ¼ × expected samples **per window**) — "expected/day" scaled to the window length.
- **Diurnal coverage** stays "≥ 3 of 4 six-hour quarters of the *day*": offsets bucketed by `((t − windowStart) mod 24h) / 6h`, so both days of a 48h window fold onto the same 4 quarters.
- **`smooth.w`** = window hours (24 | 48) stored on every sample (contract updated in `tasks.md` would be the next doc touch — flag if wanted).
- **Bug found & fixed during re-testing:** the mod-24h fold initially mapped a sample at an *exact* day-boundary offset — which is always the triggering sample itself (offset = window length) — to quarter 0, donating a free quarter and weakening the coverage rule. Fixed: exact day-boundary offsets belong to the end of the day (quarter 3), matching the pre-fold behavior. Included in the deployed build and covered by tests.
- **Emulator additions** (suite now **22/22**): prism at 4 samples/day over 2 days → `smooth.w = 48`, `smooth.n = 9` (a 24h window would hold only 4 — proves the window length), derived TwoD intact; non-prism asserts `smooth.w = 24`. Phase 1 regression re-run clean (35/35) on a fresh emulator.

### Re-run dry-runs (90 days, read-only, with 48h prism window)

| Run | Docs read | Would write | Would-be suspects | Prism smooth coverage |
|---|---|---|---|---|
| Pilot | 30,921 | 26,509 | 296 | **75.2%** (was 67.5% @24h) |
| All active | 169,186 | 138,438 | 1,672 | **75.3%** (was 73.0% @24h) |

Other types unchanged (crack 98.9%, tilt 96.5%, cracktemp 98.3%, OPKON ~97%, battery 99.3%, loadcell 92.7%). Cost unchanged (~$0.10 reads + $0.25 writes for all-active).

**Why only +2.3pp overall:** the day-fold is intentional — prisms sampling in a narrow *clock* window (ATS working-hours cycles) fail diurnal coverage no matter how long the window, and near-dead prisms (1–6 samples/90d) fail min-n. The gain concentrates in healthy prisms (pilot: +7.7pp). If prisms shouldn't be held to day-coverage at ~4 samples/day, relaxing `MIN_QUARTERS` for prisms is a one-line follow-up decision.

**Also noted:** all-active would-be suspects 1,662 → 1,672 (+10): the derived-TwoD adjusted values cross the 100mm jump default on a few more historical JTCS samples — consistent with §2.

---

## 8. Delivery report

- **Commit:** **`ec335e3`** (Phase 2 in one commit: FN-2.2/2.5 + 48h window + scripts + tests), pushed to `master`.
- **Deploy:** 2026-10-04 **16:55 UTC** — `firebase deploy --only functions:checkThresholds,functions:setBaseline,functions:recomputeSmoothing`: `checkThresholds`/`setBaseline` updated, `recomputeSmoothing` created, 0 errors. No new indexes needed.
- **Pending:**
  - [x] Backfill applied 2026-10-04 (approved; run by the agent) — see §9.
  - [x] Post-backfill sanity passed — see §9.
  - [ ] Watchdog idea for later (WD-2.1 exists): smoothing-coverage check should read `smooth.w`-aware expectations.
- **Rollback:** redeploy `26c99a5` — TwoD reverts to the old math, window back to 24h, `recomputeSmoothing` callable deletable; backfilled `smooth`/`eval`/`w` fields are inert for old code; backfill-set suspect flags can be re-litigated by a later recompute run.

### Process note
During re-testing, a duplicated test invocation ran concurrently with a clean run and contaminated its results (the emulator suites aren't idempotent on a shared DB) — this produced transient false failures, cost ~15 minutes, and was re-run cleanly on a fresh emulator. The silver lining: chasing the "failures" exposed the real quarter-fold bug above before deploy.

---

## Handbook review (2026-10-04)

- **TwoD comparison:** approved. 8 false alarms disappear, as expected.
- **H2_5D (SAVYON_LIVING "10")**: its last sample is from 2026-08-29. It has had no data for 37 days, because `h2p5d` writes into "12" (findings §4). So it won't alert on deploy. The 11.42 mm comes from Hexagon-era initials applied to live-era values, which are relative to the station's own first sample. That's the Hexagon→live cutover baseline problem (findings §7.3, BR-R.2), parked with the ATS work. It affects all live-mapped JTCS prisms under both the old and the new math.
- **37 legacy prisms** (TwoD initial, no E/N initials): leave them as they are. Fix them with the ATS repair work, after asking Nathan where their E/N zero is. Don't use `setBaseline` for this, because it would move their zero.
- **Order:** deploy before backfill, confirmed.
- **Prism window: decided 48h** (plan §8.1). It also cancels the diurnal cycle (two whole days). Coverage quarters are bucketed by `((t − windowStart) mod 24h) / 6h`. Other types stay at 24h. Implement it before the deploy, then re-run the dry-runs.

---

## Handbook review #2 (2026-10-04, after deploy `ec335e3`)

- **Full-history backfill** (the addendum): `--days=all` isn't implemented, but `--days=1000` covers every sensor's history (data starts ≈ 20 months ago). Re-runs are idempotent because the script only writes fields that changed, so `--after` resumability isn't needed. *(Superseded: `--days=all` + checkpoint/resume were implemented in §9 — and resumability turned out to be essential for the million-doc sensors.)*
- **Prism coverage 75% at 48h:** keep `MIN_QUARTERS = 3` for prisms for now. After the pilot backfill, look at which prisms lack smooth (dead/sparse vs narrow clock window) before relaxing it.

---

## 9. 90-day backfill run + batchable full-history tooling (2026-10-04/05)

### 9.1 Backfill — APPLIED (approved scope: smooth / eval / evaluator-suspect fields only)

| Run | Docs read | Written | Suspects flagged | Duration | Errors |
|---|---|---|---|---|---|
| Pilot (צייטלין + דה וינצי) | 30,923 | **26,509** | 296 | ~3.5 min | 0 |
| All active (272 sensors) | 169,202 | **111,890** | 1,672 | ~65 min | 0 |

(All-active wrote less than the dry-run's 138k because the pilot docs were already identical; a post-apply prism dry-run returned `wouldChange = 0` — direct idempotence proof.)

**Pilot sanity (all passed):** prism A11 @ דה וינצי — 118 smoothed docs, `w=48` everywhere, 0 violations of `TwoD == hypot(E,N)`, series 0.03–7.56mm; tilt @ צייטלין `w=24` x 0.005–0.009°; crack "סדק 2 חדר שינה" `w=24` x −0.585…−0.565mm; **0 data-integrity docs** created by the backfill; **checkThresholds not triggered** (executions during the window at/below baseline, zero log lines referencing backfilled sensors).

### 9.2 Coverage + prism "why missing" (90d, post-backfill)

Per type: crack 98.9% · battery 99.3% · OPKON 96.8–97.4% · cracktemp 98.3% · tilt 96.5% · loadcell 92.7% · **prism 75.2%**.
Prism misses (4,740 / 19,147 samples): **suspect 1,380 (29%) · min-n 2,644 (56%) · diurnal coverage 716 (15%)**. Worst 10 dominated by JTCS identity-error prisms (H0_12B 0% — all 225 samples suspect; H0_12A 7%; "6"@e2Nemfi 29%) and near-dead prisms (D8: 12 samples/90d).
**Implication:** relaxing `MIN_QUARTERS` would recover only ~15% of missing prism smooths — the real levers are the ATS repair (suspects) and sensor health (min-n). Recommendation: leave `MIN_QUARTERS = 3` (consistent with review #2).

### 9.3 Batchable full-history tooling — commits `96e9737` + `8d3cc99`

New script options: `--days=all` (fromTime = first sample), `--until=<ISO>` (slice fills, later samples untouched), checkpoint per finished sensor (`scripts/.recompute-checkpoint-<runId>.jsonl`, gitignored) + `--resume=<runId>`, `--max-minutes` (default 20, finishes in-flight sensors then exits with a resume hint), `--max-sensors`, `--concurrency` (default 3; per-sensor stays sequential), `--type=` filter, 10k-doc progress prints, miss-reason stats (min-n vs coverage), worst-10 coverage report. **Emulator: 9/9** (incl. interrupted+resumed ≡ uninterrupted).

**Hardening (`8d3cc99`), found the hard way:** the fleet holds **7.36M docs**, but **4 office test-rig sensors hold ~5.4M** (`di-crack-un3` 1.67M, `TILT_UN_02` 1.59M, `TILT-UN-01` 1.26M, prism `NEVIM61_1B` 923k). Million-doc sensors killed gRPC streams (ECONNRESET → poisoned channel → silent process exit mid-run). Fixes: **REST transport** for script runs + 3× per-sensor retry; checkpoint/resume recovered each aborted run. 121/272 sensors are already checkpointed in dry-run `fullhist-dryrun`.

**Full-history estimates (for the scheduled run):** ~7.36M reads ≈ $4.40; ~6.5–7M writes ≈ $12–13; wall ≈ 3h for the normal 268 sensors at concurrency 3 **plus ~2–4h just for the 4 monsters**. **Recommendation: exclude/defer the 4 test rigs** (~70% of cost/time, ≈0 monitoring value). Also: tilt `Ci5mmC7CTZ9TU0AFKRwG` "8" would receive **16,422** historical suspect flags (stuck eras) — expect large suspect counts in full history.

### 9.4 Log reviews (Phase 0/1/2 pending checks)

- **13:41→15:24 (Phase 0 era):** SKIPs — out-of-order 12 (one ATS batch), isReplay 2 (live-test docs), stale/suspect/derived 0. Errors 0. *(Full elapsed was ~4h, not 24h — deploys superseded each other same-day.)*
- **15:24→16:55 (Phase 1 code):** 71 evaluated samples, **100% received smooth** on every type seen; windowReads med 24 (tilt 48, OPKON-100 72); computeMs med 0.8–1.5s, max 5.2s. Errors 0.
- **16:55→ (Phase 2 code):** 39 samples, same profile (computeMs max 6.9s on the 72-doc OPKON). Errors 0.
- **data-integrity:** still empty — zero docs since the Phase 1 deploy (no live suspects/late-data yet; backfill never raises).
- ⚠️ **No prism samples live-evaluated since 15:24** — plausibly ATS cycle timing, re-check with the next report. *(Resolved — see §9.6: 100 prism samples evaluated overnight.)*
- **detectLevelShifts:** scheduler job ENABLED, first run 02:00 Asia/Jerusalem — results to be appended. *(Done — §9.6.)*

### 9.6 Morning-after review (2026-10-05, overnight 18:00 UTC → morning)

- **detectLevelShifts first run** (23:00 UTC = 02:00 Israel): **22 projects, 257 sensors scanned, 13,308 doc reads, 0 steps → 0 notices, 61.6s**. Clean. (0 steps is plausible: 7-day window, and the backfill-flagged suspect samples are excluded from the medians.) Note: v2 scheduled functions log under `resource.type="cloud_run_revision", service_name="detectlevelshifts"`, not `cloud_function`.
- **checkThresholds overnight:** **0 errors.** 829 evaluated samples. SKIPs: stale>48h **607** (buffered-upload drains — see below), derived:daily 176 (prism-daily worker, expected), out-of-order 27, isReplay/suspect 0.
- **Prisms are evaluated again** (yesterday's ⚠️ was ATS timing): 100 prism samples, **83% got smooth** live (w=48), reads med 20; tilt 99% (reads med 46 — the 48h… no, tilt reads med 46 reflects 2 axes/doc devices), crack/cracktemp/battery/OPKON-100 100%, OPKON-60 93%, loadcell 53% (2 sparse sensors, min-n). computeMs med 0.7–2s, max 6.5s.
- **FN-1.6 live and useful:** `data-integrity` now holds exactly **6 open `late-data` notices** (no other kinds, no noise): two sensors ~4.1d behind, two ~31.4d, two **~61.8d** — including `Ci5mmC7CTZ9TU0AFKRwG` (the 16.4k-suspect sensor) and `ViuNudIcb3TJpdbDTyXT`, both draining 2-month backlogs (counts 164/172 and climbing). This is precisely the "sensor N days behind" visibility the phase was built for — these six are a ready-made review list for Nathan.
- **No live `implausible-jump`/`out-of-range` notices yet** — refs exist fleet-wide since the backfill; no overnight jumps crossed the limits.

### 9.5 Open questions

1. Full-history run: exclude/defer the **4 test-rig monsters**?
2. `Ci5mmC7CTZ9TU0AFKRwG` (16.4k would-be historical suspects): let the full fill flag them, or baseline-review first?
3. `MIN_QUARTERS` for prisms: data says keep 3 — confirm final.
4. Zero live prism evaluations since 15:24 — check ATS liveness together with the detectLevelShifts report?

---

## Handbook review #3 (2026-10-05)

1. **Full history:** exclude the 4 office test rigs. For the rest, first run a dry-run that lists sensors where would-be suspects are > 5% of their samples. Apply only the others; hold the listed ones for review.
2. **`Ci5mmC7CTZ9TU0AFKRwG` and similar heavy-suspect sensors:** don't flag yet. Long "stuck eras" most likely mean historical `initial-value` re-zeros that were never recorded as events, because the migration created a single event per sensor. Flagging them would hide real data. Review them with Nathan first: add baseline events at the historical change points, then fill.
3. **`MIN_QUARTERS = 3` for prisms:** confirmed, final.
4. **Prism liveness:** resolved (100 prism samples overnight).
5. **The 6 `late-data` notices** are a review list for Nathan.
