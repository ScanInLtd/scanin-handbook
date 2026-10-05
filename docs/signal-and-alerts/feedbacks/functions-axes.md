# Feedback: `scanin-svc-firebase-functions` — X3 axis registry integration (+ X4 backtest input)

**Date:** 2026-10-05
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Spec:** handbook `axes.md` §4, §6 (X3–X4)
**Status:** implemented & committed (**`ffe3501`**), emulator **X3 12/12** + Phase 1/2/4 regression suites all green, X4 backtest done. **NOT deployed — pending approval. Prism flag not set.**

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

## 5. Open questions

1. cracktemp `y` stops alerting at deploy (3 sensors) — confirm that's intended *now*, or should it wait for the X4 oneoff that also clears the gaps?
2. NAVON 4/6 + JAFFA 3/5 E/N gaps (§3) — widen before the prism flag, per project with Nathan?
3. `battery.voltage` is `alertable: true` in the registry sketch (axes.md §5) but the live registry wasn't checked for battery/loadcell/inclinometer docs — loader falls back safely for missing ones; flag if you want those verified before deploy.
