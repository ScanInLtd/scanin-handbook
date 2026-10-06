# Feedback: `scanin-svc-reports` — Phase 5: reports on the same signal as the UI and alerts

**Date:** 2026-10-05 / 06
**Repo:** [scanin-svc-reports](https://github.com/ScanInLtd/scanin-svc-reports)
**Spec:** [`../phase5-reports.md`](../phase5-reports.md) (§2–§3, rollout step 2)
**Status:** ⏳ in review with Hillel. Code in the working tree, **not committed, not deployed**. Behind `ReportConfig.signalVersion = 2`; default unchanged (v1). Rollout step 2 (v1/v2 PDFs) rendered locally, reviewed by Hillel on REP106 + REP134 in short cycles. §5 acceptance: partially checked (see §6). One production write done on Hillel's explicit request (prism registry labels, §4).

---

## 1. What changed (reports repo)

| File | Content |
|---|---|
| `scripts/utils/signal.js` (new) | Pure copies of the functions semantics: `adjustedAxisValue` (prism TwoD = hypot(E−E0, N−N0), legacy fallback), `derivedAxesFromRegistry`, `makeBaselineCursor` (piecewise: initial of the latest baseline event ≤ t; before the first event → current `initial-value`, same as `recomputeSmoothing`), `axisAlerts` (registry `alertable` / prism `prismAxes` rule / `shouldEvaluateAxis` fallback **AND** warn+alarm gap set — the v2 tiers condition), `reportAxesFor` (registry `report: true` + every alerting axis, by `order`), Hebrew wording for tiers / levels / baseline reasons. |
| `scripts/utils/axisRegistry.js` (new) | Reads `devices-types/sensors/devices/{type}` and `projects/{id}.prismAxes` (+ `system-config/axes.forceLegacyPrismAxes`), cached per process. No `axes` → `null` → fallback to `SENSOR_TYPE_AXES` with a log line. |
| `scripts/utils/downsample.js` | New `reducePoints(points, {mode})`: **min + max per bucket for raw, median per bucket for smooth** (the median is a stored value at its own time). Tiered (fetch) and uniform (chart) buckets. v1 `downsampleTimeSeries` untouched. |
| `scripts/services/firestoreService.js` | `getSensorDataV2`: skips `daily::*` / `source: 'derived:daily'`; drops `suspect` samples first; raw adjusted piecewise; main line = stored `smooth.<axis>` (never recomputed); tracks replay ranges, runs without smooth, `smooth.w`; statistics accumulated on the **full-resolution** smooth series; in-flight per-series compaction (bounded memory). `getSensorAlertsV2`: top-level `alerts` by `sensorDocId`, tiered alerts + DIN alerts, placed at `sampleTime`. `getBaselineEvents`, `getLastTieredAlert`. |
| `scripts/services/prepareReportDataV2.js` (new) | The v2 per-config flow (individual sensors, groups, vibration). Writes the same `report-data.json` shape, so renderer and worker are unchanged. |
| `scripts/services/prepareReportData.js` | Branch on `Number(config.signalVersion) === 2`; optional `options.configOverrides` (local tooling only, never persisted). v1 path byte-identical. |
| `scripts/services/chartService.js` | `generateSignalChart` / `generateSignalGroupChart` (v1 chart functions untouched): `tension: 0`; smooth line breaks where there's no smooth (and across outages); raw faint when `showRaw`, raw (grey) only inside stretches without smooth otherwise; replayed raw grey-dashed; threshold lines only for alerting axes; baseline-event markers (dashed vertical + date); alert markers (▲ instant, ● confirmed, ◆ DIN; red alarm / orange warn); y-scale never clips data. **No Hebrew inside the canvas** — legend and notes are returned and rendered in HTML. |
| `scripts/services/prepareHealthReportData.js` + `health.hbs/.css` | v2: worst status computed only over axes that alert (same rule as functions/UI); extra column "התראה אחרונה" (level · tier · date of the last tiered alert). **Coded, not rendered/tested yet.** |
| Templates | `partials/signal-caption.hbs` (legend + notes under each v2 chart), `partials/signal-sensor-page.hbs` (statistics + alerts + footnotes per sensor; also used by vibration when there are DIN alerts), `partials/signal-group-page.hbs` (members table + alerts + footnotes), `css/components/signal.css`. Hooks added to `sensor.hbs`, `group.hbs`, `vibration.hbs`; v1 output unchanged (all hooks conditional on v2 fields). |
| `dataFormatConverter.js`, `renderTemplateDynamic.js` | Pass-through of `signal`, `legend`, `notes`; `subtract` helper. |
| `scripts/entry-points/render-signal-compare.js` (new) | Local v1/v2 renderer, **read-only** (no status/progress writes, no email). `--config --versions=1,2 --from --to [--showRaw] [--tables=false]`. |

### New ReportConfig fields

| Field | Default | Meaning |
|---|---|---|
| `signalVersion` | v1 | `2` → v2 pipeline |
| `showSignalTables` | `false` | v2 statistics / alerts pages (per sensor, per group, per DIN sensor with alerts). Off = charts only, like today's reports. The compare script turns it on. **UI config editor needs a toggle** (web-platform). |
| `zeroGroupSeries` | `true` | Group charts: all lines start from 0 (each line minus its first smooth value in the period). `false` = absolute values. v1 always zeroed (hardcoded). |
| `showRaw` | (existing) | v2: raw drawn faint + raw max \|value\| column in the statistics. |

## 2. Decisions taken in review (Hillel, 2026-10-05/06)

1. **Minimum first.** Sensor reports are the main path; groups important; the statistics/alerts tables are a nice-to-have behind a config flag.
2. **No-smooth periods** are a temporary data state (backfill not done yet) — no special handling beyond "gaps are gaps".
3. **Group charts: smooth only** (no raw in gaps), **all lines start from the same baseline** by default (`zeroGroupSeries`).
4. **DIN alerts are shown** (they're untiered but live, never archived).
5. **No suspect information to clients.** The "‹n› קריאות חשודות הוסתרו" footnote (spec §2.5) and the suspect column were removed. Suspect samples are still excluded from every chart and statistic. → **spec §2.5 changed.**
6. **No "מתריע" badge** on chart titles (it read as "this sensor is alarming"). Threshold lines + legend already show it. The statistics column became "ספי התראה (אזהרה / אזעקה)" with the actual gaps (`±0.1 / ±0.13`).
7. **Group members table:** per axis, the last smoothed value (bold) with the period's min – max range under it, and a caption that says what the numbers are. Absolute (not zeroed).
8. **Prisms: X / Y / Z, no TwoD** — see §4.

## 3. v1 / v2 PDF pairs (local, `output/compare/`, not sent)

| Config | Types | Period | Notes |
|---|---|---|---|
| **REP134** צייטלין 12 (`JJvTvWLMDdvYHgh0EEUP`) | 7 tilts + 5 cracks | 05/09 – 05/10/2026 | Reviewed. 1 confirmed alert (נטייה 4 Y) shown as marker + table row. |
| **REP141** דה וינצי דרום (`Nn5D8EIN9shaaSvhCqPO`) | 50 prisms in 9 groups | 05/09 – 05/10/2026 | Rendered before the X/Y/Z change — re-render pending. |
| **REP106** סביון משרדים (`liBiRvoZFEwMSylbrzQi`) | 6 prisms (group) + 1 vibration-din, `showRaw` on | 07/07 – 31/08/2026 (+ a 05/09 – 05/10 run) | Reviewed ("v2 is pretty good"). |

Runtime is about the same as v1 (REP134 30s, REP141 50s, REP106 ~2 min — dominated by the vibration fetch, same in v1). Firestore reads identical to v1 (smooth rides on the same docs; + 1 baseline query and 1 alerts query per sensor).

## 4. Production write: prism axis registry (Hillel, 2026-10-06 08:35Z)

`ops/src/oneoff/2026-10-06-prism-axis-labels.ts`, applied on Hillel's explicit request. Backup `ops/out/prism-axis-labels-backup-2026-10-06T08-35-09-554Z.json`, undo `--undo --apply`.

| Axis | Before | After |
|---|---|---|
| EastingDisplacement | תזוזה מזרח / East displacement | **תזוזה X** / X displacement |
| NorthingDisplacement | תזוזה צפון / North displacement | **תזוזה Y** / Y displacement |
| HeightDisplacement | שקיעה / Settlement | **תזוזה Z** / Z displacement |
| TwoDDisplacement | chart ✓ report ✓ alertable ✗ | chart ✗ report ✗ alertable ✗ |

- Reason: E/N are the station's local frame, not geographic east/north.
- The registry is the only place these labels live (grep over web-platform, functions, reports, bridge): UI on next load, alert texts within 10 min (functions cache), v2 reports on next run. v1 reports already said "X / Y Displacement". Old alert docs keep their stored `axisLabel`.
- **Open (Hillel handles):** 4 projects without `prismAxes: 'registry'` still alert on TwoD under the legacy rule (בדיקת שקיעות 8 prisms, JTCS_JAFFA81-89_H6 6, JTSC_COMPLEX_YAFO_H7 10, JCTS_JAFFA_63_A-08 4 — all with TwoD gaps). There TwoD would alert while hidden in the UI, and the v2 report would bring the TwoD chart back (invariant 2).
- axes.md §5 (decision A) should be updated: prism TwoD is now off everywhere, labels X/Y/Z.

## 5. What the spec got wrong about the current code

1. **Downsampling** (§1 "min + max per bucket on every numeric field"): v1 picks min/max on the **first** numeric field only and keeps whole sample objects, so `smooth` (a nested map) rode along with whichever sample won the raw min/max — not "not downsampled", but sampled by raw extremes.
2. v1 `generateChart` references undefined `xMin`/`xMax` — **the period was never applied to the x-axis** of single-series charts.
3. v1 sensor pages have **no statistics table and no alert table** (statistics are computed but unused; alerts only on the summary/events pages, which are off by default). §2.8/§2.9 are additions, not changes.
4. v1 threshold scale forces ±alarm·1.2 — **data beyond the alarm level was clipped off the chart.** (This is how DeVinci B4's −478 mm stayed invisible in v1.)
5. Prism `daily*` series were not adjusted at all (no `daily*` initials); the prism thresholds drawn in v1 came from the `daily*` threshold keys.
6. The top-level `alerts` index is `sensorDocId ASC, time DESC` — range queries **must** `orderBy('time','desc')` (ascending fails with "requires an index").
7. §2.8 "untiered alerts … were archived": true for threshold alerts, **not for DIN alerts** (`subType: 'din'`, no tier, live). Shown in v2 (decision 4).
8. §2.5 suspect footnote → removed (decision 5).
9. Group zeroing in v1 was hardcoded on, not a config option; it's now `zeroGroupSeries` (default on).
10. Vibration queries in v1 read far beyond the period (`time >= startSec` mixes seconds/ms) — REP106 reads ~373k docs for any period. Pre-existing, unchanged in v2.

## 6. Acceptance (§5) — status

| Check | Status |
|---|---|
| Main line = UI line (stored `smooth`), 5 timestamps per type | ⏳ by construction (same field, median-of-stored-values only when > 800 points per chart; REP134's 30-day tilt charts are at full resolution). Scripted spot-check not run yet. |
| Prism: Height / East / North / TwoD, lines on E/N/H only for `prismAxes: registry`, no `daily*` | ✅ updated: now **Z / X / Y** (TwoD off, §4). REP106 v2: 3 charts, lines only where gaps are set, `daily*` docs skipped (48 per sensor in Sept). |
| Non-migration baseline event: marker, raw continuous | ⏳ no non-migration event in the 3 configs' periods (all 728 are migration events). Code path exists; needs a sensor with a `setBaseline` event. |
| Suspect samples absent | ✅ dropped before everything (REP106 Sept: 18–19 per prism). Footnote count removed (decision 5). |
| cracktemp: crack opening only | ✅ **REP120** גוט לווין 34 חיפה (`f9CzPmirmTRUXxuZCIEn`, 05/09–05/10): סדק דירה 12 / 13 → one chart each, "פתיחת סדק (mm)", no temperature (v1 also showed only `x`, labelled "Displacement"). The 24h smooth removes the daily wiggle v1 showed and keeps the trend (סדק דירה 13: −1 → +1.8 mm over the month, warn ±3). PDFs: `output/compare/REP120_…_v1/v2.pdf`. |
| `grep daily2D\|dailySettlement\|…` → only fallback / v1 | ✅ only `sensorTypeAxes.js` (v1 prism charts) and a v1 debug script. |
| Health report statuses match `status.axes` | ⏳ coded (alerting-axes filter), not rendered yet. |

## 7. Data findings (not report bugs)

- **Full-history smooth backfill not run**: no `smooth` before ~2026-07-06. v2 reports reaching earlier show "אין ממוצע" (Hillel: won't send such periods).
- **SAVYON prisms: many samples get no smooth even inside the backfill window** (min-n / day-coverage rules at 48h) — v2 group charts are fragmented where v1 (prism-daily) was continuous. Hillel is checking. Must be resolved before prism-daily is stopped (step 4).
- **SAVYON September**: ~70% of prism samples are `suspect` (ATS-6 frames).
- **DeVinci B4 (`RRhr8wvLvlCTMv9OKTh6`)**: Hexagon-era initials (E −2670, N 2242, H 475) → stored smooth H −478 mm / TwoD 3487 mm. Hidden by v1's clipping; harmless in zeroed group charts; needs a baseline fix.
- **DeVinci E4**: real +12 mm step in stored smooth Z between 08/09 and 16/09 (across a data gap).
- צייטלין tilts 4/5: 67/77 stretches without smooth (late buffered uploads never got a live smooth) — shown as grey raw with a note.

## 8. Deploy plan (not done — needs approval)

1. Commit in `scanin-svc-reports` (+ the handbook oneoff and this feedback).
2. `./deploy.sh` (worker). Zero effect until a config has `signalVersion: 2`.
3. Pilot: set `signalVersion: 2` (+ `showSignalTables` as wanted) on one config via oneoff; run it from the UI; review the emailed PDF.
4. Step 3 (default v2) only after the backfill and the SAVYON coverage question.
5. Prism-daily stays untouched (step 4 not started).

## 9. Open / next

- Re-render REP141 with X/Y/Z; render one health report in v2.
- Scripted §5 spot-check (stored smooth vs report points) + a sensor with a non-migration baseline event.
- web-platform: `showSignalTables` / `zeroGroupSeries` / `signalVersion` toggles in the report-config editor.
- Pre-existing v1 glitch seen on group chart pages: the page header shows empty project crumbs (context of `{{#each charts}}`). Not touched.

---

## 10. Go-forward round (2026-10-06): v2 default, deployed

**Correction to §7 (from the handbook):** the full-history smooth backfill *was* applied (216 sensors, functions-phase4 §1). Only the 52 hold-list sensors (`hold-list-2026-10-05.md`: most SAVYON LIVING prisms, צייטלין tilts 1/2/3/5/6, …) lack smooth before ~07-06 until their baseline review with Nathan. Their v2 charts show gaps until then (accepted).

### Done
1. **v2 is the code default.** `signalVersion` missing → v2; `signalVersion: 1` forces the legacy path (emergency rollback via oneoff, no UI). Same for health reports. `showSignalTables` default `false`, `zeroGroupSeries` default `true`. v1 code kept until ~2026-10-20.
2. **REP141 re-rendered** (X / Y / Z, 63 charts per axis, no TwoD) and **REP139 health** (all sites without JCTS, 93 sensors) rendered v1/v2 → `output/compare/`.
   - Health v1 vs v2: 3 status differences, all expected (the one-wire temperature probe → N/A, temperature doesn't alert; `TILT-01-X-0` / `-Y-0` → N/A, stale `status.axes` and no thresholds). A first run wrongly hid DIN statuses — fixed (DIN sensors keep their status).
   - Health type column: Hebrew names for OPKON (+ any `OPKON_*`), cracktemp, straingage, inclinometer, load-cell-stretch, battery, loadcell; unknown types → first token, capped; CSS ellipsis so nothing spills into the next column; v2 column widths rebalanced.
   - Statistics table: threshold column as colored chips ("● אזהרה ±0.1", "● אזעקה ±0.13"), "לא הוגדרו" when not set.
3. **§5 spot-check** `scripts/debug/phase5-spotcheck.js`: **50/50 ✅** — 5 timestamps per axis on a tilt (צייטלין נטייה 1), crack (סדק 2 חדר שינה), cracktemp (גוט לווין סדק דירה 13) and prism (דה וינצי A11): every plotted value equals the stored `smooth.<axis>`; no suspect sample plotted; 76 `daily::*` docs skipped.
4. **Committed `c4224ad`, pushed, deployed** 2026-10-06 09:40Z → revision `reports-worker-00108-peh`, 100% traffic. Boot log: `build=c4224ad`, `hasSendgridKey: true` (the deploy script's "SendGrid key not found in Cloud Run, using .env" warning was harmless — key present on the revision).
5. **First scheduled runs:** `reports-orchestrator-daily` 01:00 Asia/Jerusalem (22:00Z tonight) and `nightly-reports-trigger` 02:00Z — results to be appended.

### Not done — blocked: stopping prism-daily (PD-5.1)
"Nothing reads `daily::*`" is **not true yet**:
- **web-platform** `pages/sensor-groups/sensor-group-view.component.ts`: `showDailyData = true` **by default**; prism group charts plot `dailyEasting/Northing/Settlement`, with hardcoded "X Displacement / Settlement" labels (not the registry). Pausing `daily-prism-processing` would freeze those charts. → switch the group view to `smooth` + registry labels first.
- `scanin-tool-data-replay` writes/invalidates `daily::` docs after a replay — harmless once paused.
- functions / reports: only skip-filters (`derived:daily`), fine.

### New data finding
- **דה וינצי: ~+12 mm step across the site** around a data gap 08–16/09: stored Z on A11 −11.8 mm (05/09) → +0.6 mm (18/09); E4 the same. Looks like an ATS re-setup without a baseline event — v2 reports (and the UI) show it as movement. Needs an `ats-setup` baseline event (Nathan) before DeVinci clients get v2 reports.

### Proposed follow-ups
1. web-platform: sensor-group view on `smooth` + registry labels, remove the daily toggle (unblocks PD-5.1); report-config editor toggles for `showSignalTables` / `zeroGroupSeries`.
2. DeVinci +12 mm step → baseline event with Nathan.
3. 4 projects without `prismAxes: registry` still alert on TwoD (Hillel).
4. SAVYON prisms without smooth inside the backfilled window (coverage rule) — decide before deleting prism-daily (pausing is fine).
5. Vibration fetch reads ~370k docs per report regardless of period (seconds/ms query) — cheap fix, ~2 min + reads per run.
6. Pre-existing: group chart pages show an empty project header.
7. Remove v1 code ~2026-10-20.

---

## 11. Follow-up round (2026-10-06): vibration over-read, group header — deployed

| Item | Status |
|---|---|
| **Vibration fetch over-read** | ✅ fixed, `0dcf870`. The data-log was queried as one broad range `[startSec, endMs]` (to cover both seconds and milliseconds timestamps), which matched **every millisecond-timestamped doc ever written**. Now two exact range queries, one per unit, merged and sorted. Verified on REP106's vibration sensor (`IqXkMaI2PBbxLwgJ7AOX`): Jul 7–Aug 31 **372,104 → 523 reads, same 523 samples**; Sep 5–Oct 5 548 reads / 548 samples. Whole REP106 report **124 s → 21 s**. Applies to v1 and v2 (shared `getSensorData`). |
| **Empty project header on group chart pages** (pre-existing) | ✅ fixed, `0dcf870`. `header-content.hbs` read `reportMetadata` from the current context — inside `group.hbs`'s `{{#each charts}}` that's the chart. Now `@root.reportMetadata` (report ID, project, date shown on every page type). |
| Deploy | ✅ 2026-10-06 10:48Z → revision `reports-worker-00110-sew`, boot `build=0dcf870`. Tonight's scheduled runs use this build. |
| Tonight's runs (22:00Z orchestrator, 02:00Z nightly) | ⏳ results (errors, empty charts, timings) appended in the morning. |
| Pause `daily-prism-processing` (PD-5.1) | ⏳ waiting for Hillel's confirmation that the UI group view on `smooth` is live. Pause only; delete services + v1 code ~2026-10-20. |
