# Axes — one registry, honest everywhere

_Status: decisions A–C taken (Hillel, 2026-10-05)_
_Part of: [`plan.md`](./plan.md). Evidence: `ops/src/analysis/axis-audit.ts` (read-only, re-runnable)._

## 1. The problem

"Which fields of a sensor are axes, what they're called, which ones alert, which are charted, which are in the report" is decided in **nine places**: two Firestore configs and seven hardcoded lists. They disagree. A user can set a threshold, see it drawn on the chart, and never get an alert from it. A client can get thousands of alerts on an axis their report doesn't show.

## 2. Where axes are decided today

| # | Decision | Where | Kind |
|---|---|---|---|
| 1 | Which axes exist + unit (UI charts, threshold editor, axis meanings, calc sensors) | Firestore `devices-types/sensors/devices/{type}.chart-axes` | config |
| 2 | Which axes **alert** | functions `checkThresholds.shouldEvaluateAxis`: prism → Height + TwoD only; vibration_vf → velocity only; else every axis with thresholds | **hardcoded** |
| 3 | Which axes are smoothed / derived | functions `smoothing.ts` (`PRISM_DISPLACEMENT_AXES`, TwoD = hypot(E, N)) | hardcoded |
| 4 | Suspect defaults per axis | functions `smoothing.ts defaultSuspectLimits` + UI `SUSPECT_JUMP_DEFAULTS` (duplicated) | hardcoded ×2 |
| 5 | Level-shift detection axes | functions `detectLevelShifts.ts` `PRISM_AXES` = E, N, Height (no TwoD) | hardcoded |
| 6 | Which axes are in **reports** + labels | reports `scripts/utils/sensorTypeAxes.js` | hardcoded |
| 7 | Default thresholds for new ATS prisms | bridge `buildAtsDefaultThresholdAxes` / `ATS_CHARTED_AXES` (E, N, H, TwoD at 4 / 6 mm) | hardcoded |
| 8 | Alert message axis text | functions alerts: raw key (`TwoDDisplacement`, `x`), no label or unit | implicit |
| 9 | Per-sensor meaning of an axis ("increasing = opening") | `work-sensors/{id}.axisMeanings` | config, per sensor |

## 3. What the data says (axis-audit, 22 active projects, alerts 60d)

| Type | Finding |
|---|---|
| **prism** (182) | 166 sensors have thresholds on **East / North**. They're drawn in the UI but **never alert** (hidden by #2). **7,222 alerts** in 60 days on Height (2,456) + **TwoD (4,766)**, but the report shows `daily` East / North / Settlement and **no TwoD at all**. `daily*` axes still carry thresholds on 166–167 sensors, never evaluated. |
| **cracktemp** (14) | 3 sensors have thresholds on **`y` (temperature)**. They're evaluated and can alert, but `y` is **not in chart-axes and not in the report**, so it's an invisible alerting axis. |
| **OPKON_100_Potentiometer** (1) | **No devices-types doc**, so the UI has no axes for it. Its `celsius` axis has thresholds and **alerted 6 times**. |
| **OPKON_60_Potentiometer** (11), **battery** (6) | Thresholds and alerts are possible, but they're **not in reports** (no mapping, so they fall to `default`). |
| **loadcell** (3) | Report charts `temperature`, which doesn't exist in the data. `raw` exists but isn't an axis. |
| **inclinometer** (2) | No devices-types doc; fields `x, y, temperature, depth_cm…`, no thresholds. |
| **vibration-din** | chart-axes has the typo `freqeuncy`; the data carries both `freqeuncy` and `frequency`. |
| tilt, crack | Consistent. |

## 4. The mechanism

### 4.1 One registry per sensor type (Firestore, extends the doc the UI already reads)

`devices-types/sensors/devices/{type}`:
```jsonc
{
  "chart-axes": { … },                 // kept during migration, generated from `axes`
  "axes": {
    "HeightDisplacement": {
      "label": { "he": "שקיעה", "en": "Settlement" },
      "unit": "mm",
      "role": "measurement",           // measurement | auxiliary (temperature, voltage) | derived
      "order": 1,
      "chart": true,                   // shown as a tab on the sensor page
      "report": true,                  // charted in reports by default
      "alertable": true,               // thresholds may be set on it
      "suspectJump": 100               // default plausibility level (plan §4.5)
    },
    "TwoDDisplacement": { …, "role": "derived", "derivedFrom": ["EastingDisplacement", "NorthingDisplacement"] }
  },
  "smoothingWindowHours": 48
}
```
One reviewed table, readable by anyone, edited only through a committed oneoff script (no ad-hoc console edits).

### 4.2 Per sensor, the user decides by setting thresholds

**An axis alerts if, and only if, it is `alertable` in the registry AND the sensor has a warn/alarm gap on it.** No other rule anywhere in code.

### 4.3 Honesty invariants (enforced in code, checked by the audit)

1. **No hidden filters.** Nothing in code decides alerting except §4.2.
2. **What alerts is visible.** Every axis that can alert on a sensor is a chart tab in the UI **and** is in that sensor's report, even if the registry says `report: false`.
3. **What you set is what you get.** The threshold editor lists the `alertable` axes and marks each one "מתריע" / "לא מתריע" (gap set or not). Non-alertable axes can't receive thresholds.
4. **Same words everywhere.** UI, reports, WhatsApp/email and exports use the registry `label` + `unit`, never the raw key.
5. **Derived axes are computed one way.** The `derivedFrom` formula is used by the server (smoothing / evaluation) and drawn as-is by the UI and reports.
6. **The audit is green.** `axis-audit.ts` (later a watchdog check) reports zero violations: thresholds on unknown or non-alertable axes, alerting axes missing from UI or report, types without a registry doc, fields in the data that the registry doesn't know.

### 4.4 Who reads the registry

| Repo | Reads | Replaces |
|---|---|---|
| functions | `alertable`, `suspectJump`, `derivedFrom`, `smoothingWindowHours`, labels for messages (cached per instance, 10 min) | #2, #3, #4, #5, #8 |
| web-platform | everything (tabs, editor, labels, suspect placeholders) | #1 (generated), #4 (UI copy) |
| reports | `report`, labels, units; layout config (vibration DIN charts, raw series) stays in code | #6 |
| bridge | default thresholds for new ATS points (`defaultThresholds` on the type) | #7 |

## 5. Proposed registry content (to agree with Didi / Nathan)

| Type | Axis | role | chart | report | alertable | Note |
|---|---|---|---|---|---|---|
| prism | EastingDisplacement | measurement | ✓ | ✓ | ✓ | **decision A** |
| prism | NorthingDisplacement | measurement | ✓ | ✓ | ✓ | **decision A** |
| prism | HeightDisplacement | measurement | ✓ | ✓ | ✓ | |
| prism | TwoDDisplacement | derived (E, N) | ✓ | ✓ | ✓ | **decision A** |
| prism | daily* (4) | — | ✗ | ✗ | ✗ | removed (Phase 5–6) |
| tilt | x, y | measurement | ✓ | ✓ | ✓ | |
| crack | x | measurement | ✓ | ✓ | ✓ | |
| cracktemp | x | measurement | ✓ | ✓ | ✓ | |
| cracktemp | y (temperature) | auxiliary | ✓ | ✗ | ✗ | decision B: shown, never alerts, not reported; clear the 3 existing thresholds |
| OPKON_60 | x (crack opening, mm) | measurement | ✓ | ✓ | ✓ | label it as a crack meter (today the report falls back to "Value") |
| OPKON_100 | x (mm) | measurement | ✓ | ✓ | ✓ | create the devices-types doc |
| cracktemp | celsius (temperature) | auxiliary | ✓ | ✗ | ✗ | decision C: the one-wire probe `…TEMP(one-wire)-UN-2` is a cracktemp without a crack meter |
| loadcell | x | measurement | ✓ | ✓ | ✓ | |
| loadcell | raw | auxiliary | ✗ | ✗ | ✗ | |
| battery | voltage | auxiliary | ✓ | ✗ | ✓ | health, not structure |
| inclinometer | x, y, temperature | measurement / aux | ✓ | ✓ | ✓ / ✗ | create doc |
| vibration-* | velocity, frequency | measurement | (DIN charts) | ✓ | velocity only | fix `freqeuncy` |

**Decisions**
- **A. Prisms — DECIDED 2026-10-05: East + North + Height are alertable; TwoD is charted + reported (derived), not alertable.** Today it's Height + TwoD (hidden East / North). With §4.2 this is just which defaults new sensors get; existing sensors keep exactly the thresholds they have. But today **166 prisms already carry E / N thresholds** (bridge defaults), so removing the hidden filter turns them on. Before that, a v1-vs-v2 backtest per project, then per project with Nathan: keep, or clear the E / N gaps (oneoff, dry-run → apply).
- **B. cracktemp `y` (temperature) — DECIDED 2026-10-05:** shown in the UI, never alerts, not in reports. Clear the 3 existing thresholds (oneoff).
- **C. OPKON — decided.** The `OPKON_*` type names describe the *hardware* (60 / 100 mm potentiometer), not what's measured:
  - 11 `OPKON_60` sensors are crack meters (x in mm, warn 0.3). They alert, but the report labels them "Value". Registry: x = crack opening, mm.
  - `sen-OPKON_100_Potentiometer-TEMP(one-wire)-UN-2` is a temperature probe (field `celsius` ≈ 25 °C) typed as OPKON_100. It has thresholds 27.5 / 41.25 °C and **alerted 6 times**. **DECIDED 2026-10-05:** it's a cracktemp without the crack meter. Retype it to `cracktemp`, register `celsius` on cracktemp as an auxiliary temperature axis (shown, never alerts, not reported), and clear its thresholds (oneoff, together with B).

## 6. Rollout

| Step | Repo | Content | Depends on |
|---|---|---|---|
| X0 | handbook | This doc + `axis-audit.ts`; decisions A–C | — |
| X1 | handbook | `ops/src/oneoff/2026-10-05-axis-registry.ts`: writes `axes` + `smoothingWindowHours` to 15 devices-types docs (creates OPKON_100_Potentiometer + inclinometer). Leaves the existing `chart-axes` untouched, because the live UI reads it; it's regenerated after the new UI is live. Clears cracktemp `y` thresholds/status/alert_state (31 sensors). Retypes the temperature probe to cracktemp. Backup + `--undo`. Dry-run ✅ → Hillel applies. | X0 |
| X2 | web-platform | UI reads the registry: one-axis tabs (`chart: true` + any alerting axis), labels/units, threshold editor "מתריע / לא מתריע", suspect placeholders. **Fits the current preview round** (axis tabs already requested). | X1 |
| X3 | functions | Registry loader; replace #2–#5 and #8; alert texts use labels and units. Keep the prism filter behind a flag until decision A is applied per project. Shadow-log what would alert without the filter. | X1 |
| X4 | handbook + Nathan | Prisms: E / N / H become alertable and TwoD stops alerting. Backtest v1 vs v2 per project with E / N on and TwoD off, review with Nathan, then oneoff: clear TwoD gaps (keep as chart lines?) and drop the prism filter. Also clear the cracktemp `y` and temperature-probe thresholds. | X3, decisions A–C |
| X5 | reports | Axes from the registry + invariant 2 (adds the TwoD chart for prisms); switches to `smooth` (Phase 5). | X1, Phase 5 |
| X6 | bridge | ATS default thresholds from the registry (parked with the ATS work; until then the bridge keeps its current defaults). | X1 |
| X7 | handbook / watchdog | `axis-audit.ts` violations mode; later a watchdog check. | X1 |
