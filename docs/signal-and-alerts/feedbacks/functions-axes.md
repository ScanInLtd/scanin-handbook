# Feedback: `scanin-svc-firebase-functions` — X3 axis registry integration (+ X4 backtest input)

**Date:** 2026-10-05
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Spec:** handbook `axes.md` §4, §6 (X3–X4)
**Status:** ✅ approved with changes (§6), committed **`ffe3501`** + **`675d76d`**, **deployed 2026-10-05 08:46 UTC** (checkThresholds, recomputeSmoothing, setBaseline, detectLevelShifts, handleAlerts), emulator **X3 14/14** + Phase 1/2/4 regressions green, X4 backtest done. Prism switch is **per project** (`projects/{id}.prismAxes`) — none switched yet (Hillel: דה וינצי first; NAVON/JAFFA after threshold review).

---

## 1. What changed

| Piece | Implementation |
|---|---|
| **Registry loader** | `src/axisRegistry.ts`: `devices-types/sensors/devices/{type}` (`axes`, `smoothingWindowHours`, `axesVersion`), cached per instance **10 min** (`AXES_CACHE_TTL_MS` override for the emulator). Missing doc / missing `axes` / read failure → `null` → **today's hardcoded behavior** — a registry outage can never change alerting. `system-config/axes` flags read on the same cache. |
| **Alerting rule** | An axis alerts **iff `registry.alertable` AND a warn/alarm gap is set** — in both `checkThresholds` and `recomputeSmoothing` (recompute must equal live). Fallbacks: no registry → `shouldEvaluateAxis`; vibration types untouched; **prisms stay on today's H+TwoD rule until `system-config/axes.prismRegistryAlerting === true`** (X4). While the flag is off, `[axes-shadow] <sensor> prism today=[…] registry-would=[…]` logs every prism sample where the two rules differ (E/N on, TwoD off). |
| **Suspect defaults** | Priority: explicit `thresholds.axes.<axis>.suspect` > **registry `suspectJump`** > hardcoded per-type default. (Current registry values equal the hardcoded ones — behavior-neutral.) |
| **Smoothing window** | **registry `smoothingWindowHours`** > `windowMsForType` (prism 48 / 24 — also equal to current behavior). Used by the live window query, computeSmooth and recompute. |
| **Derived axes** | Generalized to `derivedFrom` pairs (`hypot(a − a0, b − b0)` stays the **only** formula); default (no registry) = prism `TwoD = hypot(E, N)`; per-axis legacy fallback (own initial without component initials) unchanged. |
| **detectLevelShifts** | With a registry: scans **alertable measurement axes with a warn gap** (derived/auxiliary axes excluded); without: the old `PRISM_AXES` / all-threshold-axes behavior. |
| **Labels + units** | Alert docs now carry `axisLabel` (Hebrew, registry) + `axisUnit`; used by the v2 Hebrew summaries, **WhatsApp** (`buildThresholdAlertMessage` via `handleAlerts` — "ציר: פתיחת סדק", "ערך נמדד: 1.5 mm") and the **email** template ("ציר: פתיחת סדק (mm)"). Raw key kept in `axis` and used as fallback for old alerts / registry-less types. |

**Immediate behavior changes on deploy (registry content == hardcoded defaults, so almost none):**
1. **cracktemp `y` + `celsius` stop alerting** (decision B/C — the registry marks them `alertable: false`). The 3 sensors with `y` thresholds silently stop; their gap-clearing oneoff stays with X4.
2. Alert texts gain Hebrew labels/units.
3. Everything else (suspect limits, windows, derivation, prism rule) is value-identical.

## 2. Emulator results — X3 suite 12/12 ✅ (+ full regression)

| Case | Result |
|---|---|
| Type without a registry doc | warn crossing alerts exactly as before; `axisLabel` falls back to the raw key |
| cracktemp registry | `y` far beyond alarm → **0 alerts**; `x` crossing → 1 alert with `axisLabel="פתיחת סדק"`, `axisUnit="mm"` |
| Prism, flag OFF | E crossing its gap → ignored; TwoD crossing → alerts (today's rule) |
| Prism, flag ON | E alerts (Hebrew label "תזוזה מזרח"); TwoD crossing → **no** alert |

Phase 1 (35), Phase 2 (22) and Phase 4 (26) suites re-run on the same build — **all green** (the evaluator hot path changed, so the full battery was run).

## 3. X4 backtest — today (H+TwoD) vs registry (E/N/H), v2 tiers, 60 days, all prism projects

**Totals: A (H+TwoD) = 68 alerts · B (E/N/H) = 70 alerts** — switching the prism axes is volume-neutral fleet-wide under the v2 tiers. Per project:

| Project | Prisms | A (today) | B (registry) | Note |
|---|---|---|---|---|
| מגדל דה וינצי דרום | 70 | 37 | **24** | E/N gaps 8/12 — zero E/N alerts; B drops the TwoD-only noise |
| JTCS_NAVON_HOUSE_A-01 | 24 | 13 | **24** | bridge-default gaps 4/6 — E/N nearly doubles the volume |
| JCTS_SAVYON_LIVING_A-02' | 18 | 12 | 13 | gaps 5/8, mostly 1:1 |
| JCTS_SAVYON_OFFICE_A-02'' | 6 | 4 | 4 | |
| JCTS_JAFFA_68_A-05 | 9 | 2 | **5** | one sensor ("9", E gap 3/5) contributes 3 E/N alerts |

**Unreasonable E/N thresholds (≥3 E/N alerts on bridge defaults 4/6): 2 sensors, both JTCS_NAVON** — `PRISM_JTCS_H0_7A` "13" and `PRISM_JTCS_H0_8A` "15" (3 E/N alerts each). Recommendation for the X4 review with Nathan: NAVON's 4/6 defaults (and JAFFA's "9" at 3/5) want widening before the flag; דה וינצי's 8/12 are fine as-is. Re-runnable: `node scripts/backtest-prism-axes.js --days=60`.

## 4. Deploy plan (pending approval) & rollback

1. `firebase deploy --only functions:checkThresholds,functions:recomputeSmoothing,functions:setBaseline,functions:detectLevelShifts,functions:handleAlerts` (handleAlerts carries the WhatsApp/email label change; setBaseline rides the shared bundle).
2. Watch `[axes-shadow]` for the prism diff volume; the (pending) 6h `[v2-shadow]` summary clock restarts at this deploy.
3. **Not included / not set:** `system-config/axes.prismRegistryAlerting` (X4 — after the threshold review above), the cracktemp/`y` gap-clearing oneoff (X4), and the צייטלין v2 flag (previous round, still Hillel's).
4. **Rollback:** redeploy `605d537`; or delete the `axes` map from a type's doc to revert that type to hardcoded behavior instantly (loader falls back) — no redeploy needed per-type.

## 5. Open questions (answered — review 2026-10-05)

1. cracktemp `y`/`celsius`: thresholds already cleared by the X1 oneoff (08:10Z, 31 sensors + the probe retyped) — nothing pending. ✔
2. NAVON 4/6 + JAFFA 3/5 E/N gaps: wait for a threshold review; דה וינצי switches first. ✔
3. battery/loadcell/inclinometer registry docs exist (verified by Hillel). ✔

---

## 6. Review changes implemented (`675d76d`, deployed 08:46 UTC)

1. **Per-project prism switch:** `projects/{id}.prismAxes = 'registry'` → E/N/H alertable, TwoD off; missing → today's H+TwoD. `system-config/axes.forceLegacyPrismAxes` kept as a **global kill-switch** that forces the old rule everywhere. `[axes-shadow]` keeps logging for unswitched projects. One project-doc read per evaluation inside the transaction (it also serves the Phase 4 `alerting` flag); `recomputeSmoothing` mirrors the same rules.
2. **DIN routing via `alertRule`:** `registry.alertRule === 'din4150'` routes to the DIN path; the type-name check remains only as the registry-less fallback. `chartLayout`/`alertRule` added to the loader types (chartLayout is for UI/reports — unused in functions).
3. **Emulator:** Case D flips `projects/{id}.prismAxes`; new Case E proves the kill-switch overrides a switched project. **X3 suite 14/14**, Phase 4 regression green.

## 7. `[v2-shadow]` summary (07:38 → 08:50 UTC, v2 logic unchanged across deploys) + flip report

⚠️ Window covered so far: **~1.2h** (not 6h — morning traffic only). Numbers will grow with the day; re-run anytime: the summary script reads `[v2-shadow]`/`[axes-shadow]` since 07:38.

- **131 shadow evaluations** across 62 sensors in 10 projects; **v2 would have alerted: 0**.
- **v1 alerts actually fired in the same window: 2** — both prisms in an 08:41 ATS batch (`TCwyOvD2FfcXCRbp8r6J` TwoD ok→warn 4.09 vs ±4; `vhIDZp2MmZ0LJ9jOJ2b3` Height ok→warn 5.58 vs ±4). v2 would have alerted on neither (no 3h persistence) — the raw-rule noise pattern, exactly what the tiers suppress.
- **instant-off axes observed:** `crack:x` and `cracktemp:x` (sensors whose alarm gap ≥ 2.5mm makes the default instant gap ≥ the 5mm suspect jump) — at וויסקי בר, גוט לווין, בית האום. As designed; explicit `instant.gap` config can re-enable per axis.
- **`[axes-shadow]` lines: 0** — no prism of an unswitched project evaluated with E/N thresholds differing from today's rule yet (prism traffic since 07:38 was in the 08:41 batch whose E/N axes aren't thresholded... will accumulate).
- **Flip report re-run (08:47):** unchanged from the 08:00 snapshot — 16 NO-CHANGE / 3 NO-SMOOTH / **0 silent de-escalations / 0 escalation-alerts**; נטייה 7 y warn+alarm clocks now at 2× since 07:00 (the legit confirmed-alarm after flip remains likely); נטייה 5 held at alarm (suspect samples). **Still safe to flip; no seeding script needed.**

---

## 8. Post-rollout (2026-10-05 10:02Z: `alerting='v2'` on all 22 projects; `prismAxes='registry'` on דה וינצי + SAVYON LIVING + SAVYON OFFICE)

### 8.1 Fleet watch — first hours (full 24h report pending, due ~2026-10-06 10:00Z)

Since the rollout: **0 errors**, **0 v2 alerts**, **0 v1-style alerts** in `checkThresholds` — the fleet is quiet (expected: the tiers need 3h persistence or confirmed jumps; the 08:41-style raw-rule noise alerts are gone by design). The 24h collection (alerts by project/tier/level + explainability check against the smooth line) will be appended here.

### 8.2 Prism-axes backtest for the next switch candidates (60d, v2 tiers)

| Project | Prisms (thresholded, active) | With data 60d | Legacy | A (H+TwoD) | B (E/N/H) |
|---|---|---|---|---|---|
| JTCS_RKL_R2 | 12 | 7 | **5** | 0 | 0 |
| JTCS_MERCANTIL_A-03 | 5 | 2 | 0 | 0 | 0 |
| מכבי יפו מגרש 101 | 19 | 5 | 0 | 0 | 0 |
| JTSC_NEVIIM 61_A-09 | 6 | 6 | 0 | 0 | 0 |
| JTCS_jaffa_44_B-07 | 4 | 2 | 0 | 0 | 0 |
| JTCS_SHTRAUS 4_B-01 | 9 | 9 | 0 | 0 | 0 |

**All six can switch — zero alerts under either axis set in 60 days**, and no suspicious E/N thresholds. Notes:
- **RKL legacy count is 5, not 33**: of the earlier 33-prism legacy census at RKL, only 12 prisms are still active with thresholds, 5 of them legacy (`R2_B2/B4/C4/D4/D7`-family). Legacy prisms degrade gracefully after a switch — the per-sensor legacy fallback keeps their TwoD on raw−initial and their E/N adjusted values are unalerted only if un-thresholded; **at RKL the E/N axes produced 0 alerts in the backtest either way**, so switching is safe even before their E/N baselines exist (ATS repair).
- Much of the fleet here is sparse/dormant (מכבי יפו: 5 of 19 with data) — switching those is a no-op until data resumes.
- Re-runnable: `node scripts/backtest-prism-axes.js --days=60 --project=<ids>` (now supports `--project` + legacy/no-data counts, commit `514ee06`).

### 8.3 Next

Phase 5 (reports consume `smooth`) — awaiting the spec.
