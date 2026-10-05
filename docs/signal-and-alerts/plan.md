# Signal, Smoothing & Alerts — Consolidation Plan

_Status: DRAFT for review (Hillel, Didi) — 2026-10-01_
_Supersedes: `docs/data-smoothing-and-alerts-plan.md` (July 2026 proposal, never implemented)_
_Evidence: read-only analyses in `ops/src/analysis/` (re-runnable, see §9)_
_Tasks per repo: [`tasks.md`](./tasks.md)_

---

## 1. The problem in one paragraph

Clients see charts that swing, get alerts when nothing happened, and receive PDF reports that look alarming. We have tried five different smoothing mechanisms in four places (EMA in functions, three client-side moving averages in the UI, a daily prism worker, raw data in reports) — none of them drives alerts, and each screen tells a slightly different story. The fix is to have **one truthful pipeline**: correct data → one smoothed series → two-tier alerts → the same series in UI and reports, with honest labels everywhere.

## 2. What the data says (60 days, 2026-08-02 → 10-01)

| Finding | Evidence | Consequence |
|---|---|---|
| **84% of all alerts were storms, not noise.** 7,763 alerts; 6,552 were the same sensor+axis re-alerting within minutes. On 09-02 alone: 6,234. | `alert-landscape.ts`, `storm-source.ts`: on 09-02 ~3,500 *existing* `data-log` docs per sensor (20 months of history) were rewritten; `checkThresholds` fires on every write incl. updates, evaluates old samples as new, and concurrent invocations race past the 24h throttle. Caused by data copy / replay / dummy gap-fill jobs. | A plain bug. Fix first, independently of smoothing. |
| **Two-tier evaluation cuts the remaining alerts by ~80%** without missing real trends. | `backtest.ts` over 22 active projects, 506 sensor-axes: today's rule 1,354 → Tier 2 279 + Tier 1 229 (confirmed). Tilt 167→8, crack 42→1. | Adopt Didi's two tiers (refined, §4.4). |
| **Sensors fail in different ways** — smoothing alone isn't the answer for all of them. | `signal.ts`: crack 1 = 16% glitches on a flat signal; tilt 6 x = one bad reading at ~14:00 daily (not a wave); tilt 6 y = a *real* 0.07° trend over 60 days; tilt 7 y = stable at 0.12–0.14 vs warn 0.11. | Glitches → robust filter. Real trends → must still alert. Offsets → baseline workflow. |
| **76 sensor-axes are "stuck"** beyond warn >90% of the time on the smoothed series. | `backtest.ts` | Threshold/baseline problem, not noise. Needs a review list + baseline workflow. |
| **Prism data has three kinds of error** ([findings](./findings-2026-09-23.md)). (A) Station ATS-6 publishes whole cycles in a rigidly wrong frame (09-08→09-15, and 09-23 → **ongoing**; 40 sensors, 6 projects). (B) The station's point list maps some names to a neighbouring prism (~8.9 m flip-flops). (C) The 08-27 manual `ats-device-map` edits left swapped and crossed entries, and some entries route into deleted sensors. | `level-shifts.ts`, `ats-frame.ts`, `ats-crossmap.ts` | Not building movement and not noise. Fix at the station (A, B) and the bridge (C). Detect at ingestion with an identity guard and run QA (§4.1). |
| **ATS runs have common-mode errors.** Whole runs shifted (e.g. 10-01 12:20: −13.6 mm across 23 prisms, spread 1.3 mm). | `common-mode.ts` (DeVinci) | Validate per **run**, not per prism. |
| Demo/gap-fill data alerts like real data. | מכבי יפו a3/a4/a8: 128 alerts on filled (`isReplay`) data. | Replayed data must never alert and must be visibly marked. |

## 3. Principles

1. **Raw data is the source of truth and is never altered** by smoothing. Everything derived is recomputable.
2. **One smoothed series, one definition**, computed on the server, stored once, used by alerts, UI and reports. No client-side variants.
3. **Two tiers**: instant for significant movement, sensitive only for stable change.
4. **Honesty**: every alert says which rule fired and with what numbers; charts and reports label smoothed vs raw, mark baseline changes and replayed/filled data.
5. **Internal problems go to us, not the client**: data-integrity issues (impossible jumps, bad ATS runs, mapping errors) alert the ScanIn team.
6. **Only new, real samples can alert.**

## 4. Target design

### 4.1 Data correctness layer (before anything is smoothed or evaluated)

| Rule | Where |
|---|---|
| Alerts evaluate **created** samples only (trigger `onCreate`, not `onWrite`). Rewrites, migrations and recalculations never alert. | functions |
| Skip samples flagged `isReplay` / `source: 'replay'` / `suspect: true`, and samples whose `time` is older than the sensor's last evaluated sample or older than 48h. | functions |
| `alert_state` updated in a Firestore **transaction** (fixes the throttle race). | functions |
| Until Phase 4: the 24h throttle applies per **level**, not per axis (today a warn alert blocks the alarm alert that follows within 24h). | functions |
| **Plausibility level** (`suspect`, §4.5): a configurable per-axis level with per-type defaults. A raw jump beyond it means the sample is marked `suspect`, excluded from smoothing/alerts, and an **immediate internal data-integrity notice** is raised. Never silent, never deleted. | functions (+ bridge for ATS) |
| **ATS run QA**: per run, compute common-mode across the run's prisms (median deviation from each prism's recent level). Large common-mode with small spread → the run is `suspect` (station error). | ATS ingestion / bridge |
| **Prism identity**: investigate the 09-23 event and the ~8.9 m flip-flops (device-map routing, carry-over, ATS reassignment). Mapping key must be stable; mapping changes must create a baseline event (§4.2). | bridge, ATS ingestion |
| **Step detector** (daily job): persistent level shifts > 3× warn gap → internal notice "device moved / replaced / mapping changed? set a new baseline". | functions (scheduled) or watchdog |

### 4.2 Baseline events (Nathan's workflow, made explicit)

Today a single `initial-value` per axis is subtracted from **all** history, so when a sensor is replaced or moved and Nathan sets a new initial value, the old history is re-shifted too, and the smoothing/alert state mixes old and new baselines.

New: `work-sensors/{id}/baseline-events/{autoId}`:
```jsonc
{ "time": 1790000000000, "reason": "replaced | moved | rebaseline | mapping-fix | ats-setup",
  "initial": { "x": -0.923, "y": 0.71 }, "by": "nathan@…", "note": "…" }
```
- **Adjusted value = raw − initial of the latest event at or before the sample's time** (piecewise; history keeps its own baseline).
- The smoother only uses samples after the latest event; `alert_state` resets.
- UI: a single **"Set new baseline"** action (replaces editing `initial-value` directly), with reason. Charts and reports draw a marker at each event.
- Migration: create one event per sensor from the current `initial-value` at the sensor's first sample time.

### 4.3 The one smoothed series

**Definition (Didi's choice, made robust):** trailing **24h window**, first reject outliers beyond **3 × MAD** from the window median (this is the outlier rejection the prism-daily worker does today), then **trimmed mean dropping 20% each side** of what remains (what the UI MA does today). Minimum samples per window: max(3, ¼ of the sensor's daily cadence); otherwise no value.

- Computed in the same `onCreate` trigger from the last 24h of `data-log` (one query: ~6 docs for ATS prisms, ~24 for hourly tilts, ~144 for 10-min sensors). No sidecar buffer needed. Measure the actual read volume in Phase 2 (shadow) before enabling fleet-wide; if it's too high, fall back to the July plan's rolling-buffer sidecar.
- **Stored on the sample doc itself**: `smooth: { <axis>: value, n: <samples used> }`. Because alerts trigger only on create, writing this back cannot re-trigger. UI and reports already read `data-log` → they get the smoothed series for free, one fetch, one definition.
- `recomputeSmoothing(sensorId, fromTime)` callable/worker rewrites `smooth` fields (after baseline events, data adjustments, backfills). Never alerts.
- **Trailing, not centred**: the chart shows exactly what alerts used (honest), at the cost of ~12h lag on the smoothed line. Raw is one toggle away.
- Window per type is a config value. Start 24h for all; evaluate 48h for prisms (6 runs/day gives only 6 points per 24h) during the pilot.

### 4.4 Two-tier alerts (refined from Didi's proposal)

| | Tier 1 — **Instant** | Tier 2 — **Confirmed change** |
|---|---|---|
| Question | "Did something significant just happen?" | "Has the structure stably changed?" |
| Input | raw adjusted value vs the sensor's **previous smoothed value** (a jump from its own baseline, so it works even if the baseline isn't zero) | smoothed series vs existing warn/alarm (absolute, relative to baseline) |
| Threshold | `instant.gap` per axis (default = alarm gap); UI shows the **noise floor** (½ diurnal + 4σ) and refuses values below it | existing `warn.gap` / `alarm.gap` |
| Confirmation | **next sample must agree** (backtest: halves Tier 1, 503 → 229) | beyond the level for **≥ 3h and ≥ 2 evaluations**; hysteresis: back to ok only below 80% of the gap |
| Alerts | once per episode | once per escalation (ok→warn, warn→alarm); optional reminder (e.g. weekly) while it persists |
| Drives `status.axes` | can force `alarm` immediately | yes (normal path) |
| Optional | — | **rate rule** (Hillel's slope idea): smoothed change > X per 7 days |

Message wording (WhatsApp/email), always with numbers and a chart link:
- ⚡ *Instant — confirmed by 2 readings:* "Tilt 7 y jumped 0.25° within 2h (from 0.12° to 0.37°)."
- 📈 *Confirmed change:* "Tilt 7 y 24h average has been above the 0.10° warning level for 6h (now 0.12°)."
- 🔧 *Internal only (to ScanIn):* "Prism 3 @ SAVYON: impossible jump +8,866 mm — mapping/device move? Not sent to client."

Excluded: `vibration-din` (DIN 4150-3 event logic stays as is). Multi-sensor rules keep reading `status.axes` and become tier-aware (rule can require "Tier 2 on ≥ N sensors").

### 4.5 One ladder of levels per axis

Every axis has one ordered set of levels, configured in the same place (`thresholds.axes.<axis>`):

| Level | Compared | Example (tilt) | Result |
|---|---|---|---|
| `warn` / `alarm` | **smoothed** value vs baseline | 0.1° / 0.2° | Tier 2 alert to client (after confirmation) |
| `instant` | **raw** jump vs last good smoothed value | 1° (default = `alarm`) | Tier 1 alert to client (after next sample agrees) |
| `suspect.jump` | **raw** jump vs last good smoothed value | 2° | Sample `suspect`; internal notice only |
| `suspect.abs` (optional) | **raw** adjusted value | ±15° (sensor range) | Sample `suspect`; internal notice only |

- Order is enforced in the UI: `warn < alarm ≤ instant < suspect.jump`.
- **Per-type defaults** in code, so most axes need no config: tilt `suspect.jump` 1°, crack 5 mm, prism 100 mm (tune with `signal.ts`). `instant` defaults to `alarm`.
- "Last good smoothed value", not "previous sample": otherwise a sensor that stays at a wrong level is only caught once. It stays `suspect` until someone decides: new baseline (§4.2), mapping fix, or "real — release to client".
- Evaluation order per sample: `suspect` → `instant` → `warn/alarm`.
- This follows the usual split between data QC and alerting: QC flags (`pass / suspect / fail`, gross-range + spike tests, as in NOAA QARTOD) run before the trigger levels (Alert/Alarm/Action, TARP, ISO 18674). Flagged data is kept and only marked, never removed.

### 4.6 Data model (where everything lives)

No new collections for the series; one new subcollection for baselines.

```
work-sensors/{id}                       ← sensor doc
  thresholds.axes.<axis>   { warn, alarm, instant, suspect, rate }   config (UI)
  status.axes.<axis>       'ok' | 'warn' | 'alarm'                   current verdict (functions; as today)
  alert_state              per-axis memory for the evaluator          (functions)
  initial-value            mirror of latest baseline (legacy readers)

work-sensors/{id}/data-log/{sample}     ← one doc per reading (as today)
  time, <axis>…, source, isReplay       written once by ingestion, never changed
  suspect, suspect_reason               QC flag (ingestion or functions)
  smooth  { <axis>, n, replayN, v }     smoothed adjusted value at this time  (functions)
  eval    { <axis>: 'ok'|'warn'|'alarm'|'suspect' }  per-sample verdict  (functions)

work-sensors/{id}/baseline-events/{autoId}   ← new (§4.2)

alerts/{id}                             ← client-facing events, as today + tier, sampleTime, smoothValue

data-integrity/{id}                     ← new: internal notices to ScanIn (never to clients),
                                          one open doc per kind+sensor+axis, open → resolved
```

- The evaluator does **one write-back per sample** (`suspect` + `smooth` + `eval` in a single `update`). It doubles writes on `data-log`; acceptable at current volume, measured in Phase 2.
- `eval` makes the chart self-explaining (points coloured by verdict) and lets the backtest compare stored verdicts with simulated ones. `status.axes` stays the single "now" verdict that UI, multi-sensor rules and reports read.
- `ema` / `ema-log` disappear (Phase 6). `daily::` docs stay read-only until prism-daily is stopped (Phase 5).

## 5. Existing mechanisms — decision for each

| # | Mechanism (where) | What it does today | Decision | Replacement / action |
|---|---|---|---|---|
| 1 | **`checkThresholds`** — functions | `onWrite` on every `data-log` doc; raw adjusted value vs ±warn/alarm; alert on worsening; 24h throttle (racy) | **Rewrite** | `onCreate` + data-correctness rules (§4.1) + smoothing (§4.3) + two tiers (§4.4) + transaction |
| 2 | **EMA** — functions (`options.movingAverage`, `ema` field, `ema-log`, `recalcEma`), UI overlay in `sensor-chart-main` / `default-chart`, toggle in `sensor-data.service` | Incremental EMA α=0.05 per sample, opt-in (3 sensors enabled); no outlier rejection; no spectral null at 24h; never drives alerts | **Remove** | Replaced by §4.3. Disable on the 3 sensors at UI cutover; remove code; delete `ema-log` subcollections in cleanup (destructive — separate approval) |
| 3 | **UI moving average — default chart** (`default-chart.component.ts`) | Client-side trailing 24h, drops 20% each side, toggle + settings; O(n²) in browser; recomputed per user | **Remove** | Stored `smooth` series is the default line; raw is a toggle |
| 4 | **UI moving average — prism chart** (`prism-chart.component.ts`) | Client-side trailing 48h with outlier %, on raw TwoD/Settlement | **Remove** | Same stored series |
| 5 | **UI "Moving Avg." button — legacy line chart** (`new-line-chart.component.ts`, `DefaultChart.ts`) | Sample-count average, no time window, no outlier handling | **Remove** | — (check whether the component is still routed; remove if dead) |
| 6 | **UI line "smoothing" (curve tension 0.4)** — prism chart | Cosmetic Bézier curves between points; can draw overshoots that aren't in the data | **Remove (tension 0)** | Straight lines; honesty |
| 7 | **Prism daily worker** — `scanin-worker-prism-daily` (`daily::{date}::{axis}` docs: `daily2Ddisplacement`, `dailySettlement`, `dailyEasting/Northing…`; MAD + speed gate + trimmed mean; nightly 00:05) | The only robust prism smoothing; once a day; separate axis names; skipped by alerts; drives prism charts (daily shown by default) and reports ("Processed") | **Stop & delete** | No migration of its code (§4.3 and §4.1 cover the same ideas). Keeps running untouched until UI and reports both read `smooth`, then stop scheduler + delete services (Phase 5); keep historical `daily::` docs read-only. Long-range views use a daily downsample of `smooth`, computed at read time |
| 8 | **Thresholds on daily axes** (`thresholds.axes.daily*` on prisms) | Never evaluated (daily docs skip alerts); used only for chart lines / report health status | **Migrate & remove** | Tier 2 thresholds live on the raw axis names; migrate values (if different) then drop the `daily*` keys |
| 9 | **Reports** — `scanin-svc-reports` (`prepareReportData`, `sensorTypeAxes.js`, downsampling) | Raw `data-log` downsampled (min-max); prisms plot daily "Processed" + optional raw; health report uses `status.axes` | **Switch** | Plot stored `smooth` as the main line, raw optional & faint; mark baseline events and replayed periods; threshold lines = Tier 2 levels; health report reads the new statuses |
| 10 | **Alert throttle** (`alert_state`, 24h `min_hours_between_same_level_alerts`) | Throttles re-alerts; bypassed by races | **Replace** | Episode logic (§4.4) + transaction; the 24h constant goes away |
| 11 | **`initial-value`** on sensor doc | Single offset applied to all history | **Replace** | Baseline events (§4.2); field kept as "current baseline" for compatibility during migration |
| 12 | **Data replay / gap-fill / demo copies** — `scanin-tool-data-replay`, ad-hoc copy scripts | Writes `isReplay` docs and rewrites history → triggers alerts | **Keep, constrain** | Never alerts (§4.1, Phase 0); *later:* after a run call `recomputeSmoothing`; UI/reports render replayed segments distinctly (dashed/grey + legend). Decide policy for demo data in client-facing reports |
| 13 | **Data adjustments** — `scanin-worker-firestore-adjustments`, UI `data-handling-tools` | Modify samples in place | **Keep, hook** | Must call `recomputeSmoothing`; if adjustment = re-baseline, create a baseline event instead |
| 14 | **Calculated sensors** — `calcSensors` (every 30 min, Pub/Sub) | Write derived samples into their own `data-log` | **Keep** | They flow through the same pipeline (smoothed + tiers) automatically; verify their inputs use raw, not smoothed |
| 15 | **ATS `suspect` flag** (`source: 'ats_live'` samples) | Exists, rarely set | **Extend** | Set by run QA (§4.1); `suspect` samples excluded everywhere except a "show suspect" debug toggle |
| 16 | **Multi-sensor rules** — `evaluateMultiSensorRules` | Triggered per alert doc, reads `status.axes` | **Keep, tier-aware** | Better input automatically; add optional "tier" condition |
| 17 | **July 2026 plan** (sidecar rolling buffer, `sma-log`, `options.smoothing`) | Never built | **Superseded** | Same intent; this plan stores the series on the sample doc instead of a sidecar + extra log |

## 6. Per-repo work

| Repo | Work |
|---|---|
| `scanin-svc-firebase-functions` | New `onCreate` evaluator (data rules, smoothing, two tiers, transaction, episode logic, tier field on alert docs); `recomputeSmoothing`; step-detector job; internal data-integrity notices; message templates; remove EMA (`recalcEma`, `ema-log` writes) |
| `scanin-web-platform` | Default chart = stored `smooth` + raw toggle; remove 3 client MAs, EMA overlay, curve tension; "Set new baseline" action + markers; replayed/suspect styling; threshold settings: instant gap + noise-floor hint, optional rate rule; alert list shows tier |
| `scanin-svc-reports` | Plot `smooth` + optional raw; baseline/replay markers; Tier 2 threshold lines; switch prisms off `daily*` axes |
| `scanin-svc-mqtt-bridge` | Prism identity investigation & fix; ATS run QA → `suspect`; plausibility cap at ingestion for ATS |
| `scanin-worker-prism-daily` | Untouched until Phase 5, then stop scheduler + delete services; archive repo |
| `scanin-handbook` | This plan; `ops/` backtests as the regression tool (also replaces watchdog checks for now); review list for stuck sensors |
| *Deferred* | `scanin-svc-hexagon-ats-ingestion` (deprecated path). *Later:* `scanin-tool-data-replay` / adjustments worker (`recomputeSmoothing` hook), `scanin-svc-watchdog` (storm / integrity / coverage checks) |

## 7. Rollout

| Phase | Content | Exit criteria |
|---|---|---|
| **0 — Stop the bleeding** (now, small) | `checkThresholds` → `onCreate`, skip replay/old samples, transaction. Investigate the 09-23 prism event. | No storms (alerts with same sensor+axis < 60 min apart ≈ 0). Root cause of 09-23 known. |
| **1 — Data correctness** | Plausibility cap, ATS run QA, step detector → internal notices. Baseline-events model + migration. Review list of the 76 stuck axes with Nathan. | Internal notices flowing; stuck list triaged. |
| **2 — Smoothing in shadow** | Compute + store `smooth` on new samples; backfill 90 days via `recomputeSmoothing`; no alert change yet. | Backtest on stored series matches §2 numbers; Didi approves charts on pilot sites. |
| **3 — UI** | Smoothed default, raw toggle, remove client MAs/EMA/tension, baseline action + markers, replay styling. | One smoothed definition on every screen. |
| **4 — Alerts switch** | Two tiers per site. Pilot: צייטלין 12 (tilts/cracks) + one ATS site (DeVinci or SAVYON). Then all active sites. | Alerts/day down ≥ 70% vs baseline with no missed real event in pilot review. |
| **5 — Reports** | Switch to `smooth` + markers; stop & delete prism-daily. | Reports match UI. |
| **6 — Cleanup** | Remove EMA code, `daily*` thresholds; archive prism-daily; delete `ema-log` / old `daily::` docs (**destructive — separate approval**). | Single pipeline in code. |

## 8. Decisions needed

1. ~~Smoothing window for prisms~~ **Decided 2026-10-04: 48h for prisms** (24h covered prisms only 73% of the time; 48h also cancels the diurnal cycle). Other types: 24h.
2. ~~Tier 2 persistence and reminders~~ **Decided 2026-10-05:** ≥ 3h and ≥ 2 evaluations; no reminders.
3. ~~Tier 1 default~~ **Decided 2026-10-05:** `instant.gap` default = 2 × alarm gap. If that is ≥ `suspect.jump`, the instant tier is off for that axis.
4. ~~Who receives internal data-integrity notices?~~ **Decided 2026-10-04:** a Firestore collection `data-integrity` for now (separate from `alerts`, so it can never reach clients). Later: a configurable WhatsApp group and a UI page.
5. Policy for demo/replayed data in client-facing reports (allowed with marking? never?).

## 9. Evidence & tooling (re-runnable, read-only)

Run with `./go.sh run <script> …` from the handbook root.

| Script | Use |
|---|---|
| `ops/src/analysis/alert-landscape.ts --since=60d` | Alert volume, storms vs genuine, top sensors |
| `ops/src/analysis/alert-timeline.ts <sensorId>` | Per-day alert counts, spacing (throttle failures) |
| `ops/src/analysis/storm-source.ts <sensorId> --day=` | Which docs were created/rewritten on a day |
| `ops/src/analysis/signal.ts <sensorId> --axis=` | Anatomy (drift, diurnal, noise, spikes) + strategy comparison |
| `ops/src/analysis/backtest.ts --days=60` | Fleet: today's rule vs two tiers, stuck axes, noise floors → `ops/out/backtest-*.json` |
| `ops/src/analysis/common-mode.ts <project>` | ATS run-level common-mode error |
| `ops/src/analysis/level-shifts.ts --days=180` | Persistent steps (moves / mapping errors), grouped by site+day |

The backtest is the regression tool: rerun it after each phase and compare.
