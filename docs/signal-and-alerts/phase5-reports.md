# Phase 5 — Reports on the same signal as the UI and alerts

_Status: SPEC (Hillel, 2026-10-05). Repo: `scanin-svc-reports`. Supersedes tasks.md §3 (REP-5.x)._
_Context: [`plan.md`](./plan.md) §4.3–4.6, [`axes.md`](./axes.md). As of 2026-10-05, the UI (live), alerts (v2 on every site) and the axis registry already use the server-side `smooth` series. Reports are the last place still showing a different story._

## 1. What's wrong today (code read 2026-10-05)

| Area | Today | Problem |
|---|---|---|
| Series | `getSensorData` reads raw `data-log`, subtracts the **current** `initial-value` from every field | Not the line the client sees in the UI or gets alerted on; history before a baseline change is shifted wrongly |
| Prisms | "Processed" = `daily*` axes from the prism-daily worker (`sensorTypeAxes.js`); raw optional | Different smoothing (daily, MAD + speed gate) and different axis names; **no TwoD chart**; prism-daily can't be stopped |
| Axes / labels | Hardcoded `SENSOR_TYPE_AXES` (+ `default` → "Value") | OPKON / battery fall to "Value"; loadcell charts a `temperature` that doesn't exist; disagrees with the UI |
| Downsampling | min + max per bucket on every numeric field | Fine for raw (keeps peaks); wrong for a smoothed series (re-introduces spikes); `smooth` is a nested map, so it's not downsampled at all |
| Threshold lines | `thresholds.axes[field]` drawn on the adjusted view | Drawn on axes that don't alert (e.g. prism TwoD on `prismAxes: registry` sites) |
| Bad data | Every sample plotted | Samples flagged `suspect` (implausible jump, bad ATS run) still drawn |
| Alerts | Read from `work-sensors/{id}/alerts` (old subcollection) | Live alerts are in the top-level `alerts` collection, so report alert sections are empty or stale |
| Statistics | min / max / avg on raw | One glitch defines "max" |
| TwoD (raw) | `raw − initial.TwoD` | Wrong for a magnitude (FN-2.5); must be `hypot(E − E0, N − N0)` |
| Line style | `tension: 0.4` in `generateChart` | Curves draw overshoots that aren't in the data |

## 2. Target behavior

Same signal, same axes, same words as the UI:

1. **Main line = `smooth.<axis>`** (stored adjusted, 24h; prisms 48h). The legend reads "ממוצע ‹w› שעות (ללא חריגים)", with `w` from `smooth.w`.
2. **Raw** is optional (`config.showRaw`), drawn faint and labelled "גולמי". Adjusted **piecewise**: each sample uses the baseline event in force at its time. Prism TwoD raw = `hypot(E − E0, N − N0)` (legacy fallback as in functions `adjustedAxisValue`).
3. **Axes from the registry** (`devices-types/sensors/devices/{type}.axes`): charts for axes with `report: true`, **plus any axis that alerts on this sensor** (invariant 2). Order = `order`, title = `label.he (unit)`. `chartLayout: "din4150"` / `"vibration-vf"` keep their existing vibration chart configs (layout stays in code); only labels/units come from the registry.
4. **Threshold lines only where the axis actually alerts** (same rule as functions and the UI): registry `alertable` AND gap set, and for prisms the project's `prismAxes` rule (`registry` → E/N/H; missing → H + TwoD). Lines are drawn against the smoothed series.
5. **`suspect` samples are excluded** from every series and from statistics. A footnote gives the count: "‹n› קריאות חשודות הוסתרו".
6. **Replayed data** (`isReplay` / `source: replay`): dashed grey segments on raw, plus a footnote with the date ranges ("נתונים משוחזרים: ‹from›–‹to›").
7. **Baseline events** (`work-sensors/{id}/baseline-events`, excluding `reason: migration`): a vertical marker with the reason and date on every chart of that sensor.
8. **Alerts**: from the top-level `alerts` collection by `sensorDocId` + `time` (index `sensorDocId ASC, time DESC` exists). Tiered alerts (`tier` present) as markers on the axis chart (⚡ instant / 📈 confirmed, colored by level) and in the sensor's alert table, using the Hebrew `axisLabel`. Untiered alerts (legacy, before 2026-10-05 10:02Z) are not shown (they were archived to `alerts-archive`).
9. **Statistics** on the smoothed series (min / max / avg / last). Plus raw max |value| only when `showRaw` is on, labelled as raw.
10. **Gaps are gaps.** Periods without `smooth` (not enough samples, or older than the backfill) show raw (if available) plus the note "אין ממוצע לתקופה זו". No client-side smoothing, ever.
11. **Line style**: `tension: 0` everywhere.
12. **Health report**: status from `status.axes` (now v2), alerting axes per the same rule as 4, the tier of the last alert, and open `data-integrity` notices are **not** shown (internal).

## 3. Implementation notes

- **Fetch** (`firestoreService.getSensorData`):
  - skip `daily::*` docs and `source: 'derived:daily'`;
  - flatten `smooth.<axis>` → `smooth_<axis>` on each sample, plus `smooth.w`;
  - keep `suspect`, `isReplay`, `source`;
  - load the baseline events once per sensor and adjust raw piecewise;
  - share the adjusted-value logic with functions semantics: E/N/TwoD rules, legacy fallback.
- **Downsampling** (`utils/downsample.js`): keep min + max for raw fields. For `smooth_*` fields use **median per bucket** (or the last value per bucket). Never min / max on the smoothed series. Suspect samples are dropped **before** downsampling.
- **Registry loader**: one small module (`utils/axisRegistry.js`), cached per run. If a type has no `axes`, fall back to the current `SENSOR_TYPE_AXES` and log it (the audit should catch it).
- **`sensorTypeAxes.js`**:
  - keep only the vibration layouts and the fallback;
  - delete the prism `daily*` charts;
  - prism charts become one per registry axis (Height, East, North, TwoD), each with series `[smooth (always), raw (showRaw)]`.
- **Group charts** (`generateMultiSensorChart`, `zeroSeries`): use the smoothed series. Zeroing becomes unnecessary once baselines are right, so make it a config option, default off for smoothed data.
- **Language**: report text is Hebrew. The registry `label.he` is used for titles, legends and tables.
- **Performance**: the smooth fields ride on the same docs, so there are no extra reads. Baseline events are one small query per sensor. The `alerts` query is one per sensor per report.

## 4. Rollout

1. Implement behind a ReportConfig flag `signalVersion: 2` (default off), so the worker can render both.
2. Render v1 and v2 side by side for 3 real configs (צייטלין 12 tilts + cracks, דה וינצי prisms, one SAVYON project), same period → PDFs for Didi.
3. Switch the default to v2 for all configs (one write to ReportConfig, or flip the code default). Keep v1 code paths for 2 weeks.
4. **Then stop prism-daily** (PD-5.1): pause the Cloud Scheduler job `daily-prism-processing`; keep the services deployed 2 weeks for rollback; then delete them and archive the repo. Historical `daily::*` docs stay read-only until Phase 6.
5. Remove the v1 paths (`daily*` charts, current-initial-value adjustment, min/max on smoothed series, old alerts subcollection).

## 5. Acceptance

- For a pilot sensor and period, the report's main line equals the UI chart line (the same stored `smooth` values). Spot-check 5 timestamps per type.
- Prism report: Height / East / North / TwoD charts. Threshold lines on E/N/H only for `prismAxes: registry` projects. No `daily*` anywhere.
- A sensor with a non-migration baseline event: a marker on the chart; the raw series continuous across it.
- A sensor with suspect samples: they're absent, and the footnote count is right.
- A cracktemp report: crack opening only, no temperature (`report: false`, not alerting).
- `grep -rn "daily2D\|dailySettlement\|dailyEasting\|dailyNorthing" scripts/` → only the fallback / v1 path, removed in step 5.
- Health report statuses match `status.axes`.
