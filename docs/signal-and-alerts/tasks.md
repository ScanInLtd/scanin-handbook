# Signal, Smoothing & Alerts — Tasks per Repo

Design & rationale: [`plan.md`](./plan.md) (read first). Each section below is **self-contained**, so it can be copy-pasted to the owning repo. Task IDs are `<REPO>-<phase>.<n>`. Phases match plan §7:

| Phase | Name | Gate to start |
|---|---|---|
| 0 | Stop the bleeding | now |
| 1 | Data correctness + baseline events | Phase 0 deployed |
| 2 | Smoothing in shadow | `FN-1.*` deployed |
| 3 | UI | `FN-2.*` backfilled on pilot sites |
| 4 | Alerts switch (pilot → all) | Didi approves pilot charts |
| 5 | Reports | Phase 4 on all sites |
| 6 | Cleanup (destructive steps need explicit approval) | Phase 5 stable for 2 weeks |

Pilot sites: **צייטלין 12 תל אביב** (`oBcqejjRiLRIFhG2UzPI`, tilts + cracks) and one ATS site (**מגדל דה וינצי דרום** `hmPh7Hg2fjTc9GyNRDYO` or **JCTS_SAVYON_LIVING_A-02'** `pUeJ6MlE8HwJPV57kETZ`).

Regression tool for every phase (handbook): `./go.sh run src/analysis/backtest.ts --days=60` and `alert-landscape.ts --since=7d`.

---

## Shared contract (referenced by all sections)

**Sample doc** — `work-sensors/{id}/data-log/{autoId}` (raw, written by bridge / ATS / calcSensors / replay):
```jsonc
{
  "time": 1790859605752,            // epoch ms (required)
  "<axis>": 0.583,                   // raw values, unchanged forever
  "source": "ats_live",             // optional: ats_live | replay | derived:daily | …
  "isReplay": true,                  // optional: synthetic/demo/gap-fill data
  "suspect": true,                   // optional: failed plausibility / run QA
  "suspect_reason": "run-common-mode", // optional
  // written back by functions (Phase 2), never by clients:
  "smooth": { "<axis>": 0.121, "n": 23, "replayN": 0, "v": 1 }
}
```

**Baseline event** — `work-sensors/{id}/baseline-events/{autoId}` (Phase 1):
```jsonc
{ "time": 1790000000000, "reason": "replaced|moved|rebaseline|mapping-fix|ats-setup|migration",
  "initial": { "<axis>": -0.923 }, "by": "uid or email", "note": "free text", "createdAt": 1790000000000 }
```
Adjusted value of a sample = raw − `initial` of the **latest event with `time ≤ sample.time`**. `work-sensors/{id}.initial-value` mirrors the latest event during migration (read by legacy code only).

**Smoothing (v1)** — for each new sample, per axis with thresholds:
1. Window = samples with `time ∈ (t − 24h, t]`, after the latest baseline event, excluding `suspect: true`.
2. Reject values with |v − median| > 3 × MAD (MAD = median absolute deviation; skip rejection if MAD = 0).
3. Trimmed mean of the remaining values, dropping 20% from each end.
4. Require n ≥ max(3, ¼ × expected samples/day); else no `smooth` value for that axis.
5. Store **adjusted** smoothed value (raw − baseline) in `smooth.<axis>`, plus `n`, `replayN` (replay samples used), `v: 1`.

**Alert doc** — `alerts/{id}` gains:
```jsonc
{ "tier": "instant | confirmed | rate | integrity", "smoothValue": 0.121, "baseline": 0.12,
  "persistedHours": 6, "confirmations": 2, "internalOnly": false, "sampleTime": 1790859605752 }
```
`internalOnly: true` → `handleAlerts` sends to the ScanIn ops recipients only, never to client users.

**Sensor config** — `work-sensors/{id}.thresholds.axes.<axis>` gains optional:
```jsonc
{ "warn": {"gap": 0.08}, "alarm": {"gap": 0.1},
  "instant": {"gap": 0.1},                 // Tier 1 jump from baseline; default = alarm.gap
  "rate": {"gap": 0.03, "days": 7} }        // optional Tier-2 rate rule
```

---

## 1. `scanin-svc-firebase-functions` (core)

**Context:** `checkThresholds` (`src/checkThresholds.ts`) runs `onWrite` on every `data-log` write and compares the raw adjusted value of a single sample against ±warn/alarm, with a 24h throttle in `alert_state`. In the last 60 days 84% of all alerts (6,552 / 7,763) came from rewrites of historical data (copy/replay/gap-fill jobs) that re-triggered it, with concurrent invocations racing past the throttle. Remaining alerts are dominated by noise. This repo owns the new evaluation pipeline. Read "Shared contract" above.

### Phase 0 — stop the bleeding
- **FN-0.1** Change `checkThresholds` trigger from `.onWrite` to `.onCreate` (`functions.firestore.document("work-sensors/{sensorId}/data-log/{entryId}").onCreate`). Updates to existing samples must never evaluate.
- **FN-0.2** Early-return (log at info) when: `isReplay === true` || `source === 'replay'` || `suspect === true` || `source === 'derived:daily'` || `time < Date.now() − 48h` || `time <= sensor.alert_state.last_sample_time` (out-of-order / backfill). Store `alert_state.last_sample_time` on each evaluation.
- **FN-0.3** Wrap the read-evaluate-write of `status.axes` + `alert_state` + alert creation in `db.runTransaction` so concurrent samples of one sensor can't double-alert.
- **FN-0.4** Add `sampleTime` (the sample's `time`) to alert docs (`createNewAlertObject`) — currently only creation time is stored, which hides backfill storms.
- **Acceptance:** run a test replay on a test sensor (`בדיקות משרד` project) → 0 alerts. Handbook `alert-landscape.ts --since=7d` shows ≈0 "throttle-violating bursts".

### Phase 1 — data correctness & baseline events
- **FN-1.1** Plausibility cap per sensor type (config map in code, e.g. `prism: 100 mm` between consecutive samples, `tilt: 1°/h`, `crack: 5 mm/h`; tune with handbook `signal.ts`). Violation → update the sample with `suspect: true, suspect_reason: 'implausible-jump'` (allowed: alerts are onCreate only) and create an alert doc `{ tier: 'integrity', internalOnly: true }`.
- **FN-1.2** Baseline events: implement adjusted-value lookup per the contract (cache latest events per sensor in the invocation). Callable `setBaseline({ sensorId, time?, reason, note, initial? })` (admin/installer only): if `initial` omitted, compute it as the median of raw values in the 24h after `time`; write the event, mirror into `initial-value`, reset `alert_state` and `status.axes` to `ok` for that sensor.
- **FN-1.3** Migration script (`scripts/`, dry-run by default): for every sensor create one `baseline-events` doc `{ reason: 'migration', time: <first sample time>, initial: <current initial-value> }`.
- **FN-1.4** Scheduled `detectLevelShifts` (daily 02:00 Asia/Jerusalem): per active sensor (project `isActive`), daily medians of the last 7 days; a step > 3 × warn gap that persists ≥ 2 days → `integrity` alert, `internalOnly`, message "possible device move / replacement / mapping change — set a new baseline". Port logic from handbook `ops/src/analysis/level-shifts.ts`.
- **FN-1.5** `handleAlerts`: route `internalOnly` alerts to an ops recipient list (config doc `system-config/ops-recipients`, decision pending) and skip client users.
- **Acceptance:** 09-23-type prism jumps produce one internal notice per sensor, no client alerts; `setBaseline` round-trip tested on a test sensor.

### Phase 2 — smoothing in shadow
- **FN-2.1** In the onCreate evaluator compute `smooth` per the contract and write it back to the sample doc (`snapshot.ref.update({ smooth })`). Alerts unchanged in this phase.
- **FN-2.2** Callable/HTTP `recomputeSmoothing({ sensorId, fromTime })` (admin): replays samples from `fromTime` in order, rewrites `smooth` fields in batches of 400. Never alerts, never touches raw fields. Called by: baseline events (FN-1.2), replay tool, adjustments worker.
- **FN-2.3** Backfill 90 days for pilot sites, then all active projects.
- **FN-2.4** Log per invocation: window read count, compute ms. Report daily read volume to `system-metrics/firebase-functions/daily/{date}.smoothingReads` (increment).
- **Acceptance:** handbook backtest re-run on stored `smooth` ≈ simulated numbers; read volume acceptable to Didi.

### Phase 4 — alerts switch (per site flag `projects/{id}.alerting = 'v2'`)
- **FN-4.1** Tier 2 (`tier: 'confirmed'`): evaluate `smooth.<axis>` vs warn/alarm. Escalate only if beyond the level for ≥ 3h **and** ≥ 2 evaluations (store candidate level + since in `alert_state.axes.<axis>`). De-escalate only below 80% of the gap. Alert once per escalation; no 24h re-alerts.
- **FN-4.2** Tier 1 (`tier: 'instant'`): |raw adjusted − previous `smooth`| > `instant.gap` (default alarm gap), **confirmed by the next sample** (store pending in `alert_state`). One alert per episode; episode ends when the jump falls below half the gap. Forces `status.axes.<axis> = 'alarm'` until Tier 2 takes over.
- **FN-4.3** Optional rate rule (`tier: 'rate'`): if `rate` configured, Δ of `smooth` over `rate.days` > `rate.gap` → one alert per episode.
- **FN-4.4** Optional reminders while in warn/alarm (cadence = config, default none).
- **FN-4.5** Message templates (`alerts/emailTemplate.ts`, `alerts/whatsappService.ts`, `alerts/handleAlerts.ts`), Hebrew + numbers + chart link:
  - ⚡ instant: "‹sensor› ‹axis› קפץ ‹Δ› תוך ‹h› שעות (מ-‹baseline› ל-‹value›), אושר ע״י 2 קריאות"
  - 📈 confirmed: "הממוצע היומי של ‹sensor› ‹axis› מעל סף ‹level› כבר ‹h› שעות (כעת ‹smooth›)"
  - 🔧 integrity (internal only)
- **FN-4.6** `evaluateMultiSensorRules`: accept optional `tier` condition in `multi-sensor-rules` docs.
- **Acceptance:** pilot site 2 weeks: alerts/day ↓ ≥ 70% vs the prior 2 weeks, every remaining alert explainable from the chart; no real event missed (review with Didi).

### Phase 6 — cleanup
- **FN-6.1** Remove EMA: `options.movingAverage` handling and `ema-log` writes in `checkThresholds.ts`, `src/recalcEma.ts` + export in `src/index.ts`.
- **FN-6.2** Remove legacy throttle constant `MIN_HOURS_BETWEEN_ALERTS` usage and the legacy min/max threshold fallback (`evaluateNewThreshold`), after confirming no sensor uses `normal.min/max`.
- **FN-6.3** Script (dry-run default, **destructive, needs approval**): delete `ema-log` subcollections; drop `thresholds.axes.daily*` keys.
- **FN-6.4** Sync `shared-status-types` (new tier types) to web-platform and reports.

---

## 2. `scanin-web-platform` (UI)

**Context:** The sensor page has four different "smoothing" mechanisms, none of which matches what alerts use: a client-side 24h trimmed MA in `default-chart`, a client-side 48h MA in `prism-chart`, a sample-count "Moving Avg." in the legacy `new-line-chart`, an EMA overlay from `ema-log`, plus curved-line tension in the prism chart. From Phase 2 every sample carries a server-computed `smooth` field (see "Shared contract"); the UI must show that one series, honestly labelled.

### Phase 1
- **UI-1.1** "Set new baseline" action on the sensor page (installer/admin): reason (replaced / moved / rebaseline / mapping-fix / ats-setup), optional time, note → calls `setBaseline` callable. Replaces direct editing of `initial-value` in sensor settings (keep the field read-only, showing the current baseline).
- **UI-1.2** Baseline-event markers (vertical line + tooltip with reason, who, when) on all sensor charts.
- **UI-1.3** Admin page listing internal `integrity` alerts (implausible jumps, level shifts, bad ATS runs) with link to the sensor and a "set new baseline" shortcut.

### Phase 3
- **UI-3.1** Default chart series = `smooth.<axis>`; raw as a toggle ("הצג נתונים גולמיים"), drawn faint. Legend wording: "ממוצע 24 שעות (ללא חריגים)" / "גולמי".
- **UI-3.2** Remove client-side MA in `pages/site/sensor-cmp/sensor-chart-main/type-specific/default-chart/default-chart.component.ts` (`showMovingAverage`, `maWindowHours`, `maOutlierPercent`, `calculateMovingAverageData`, `calculateFilteredAverage`, settings popup).
- **UI-3.3** Remove client-side 48h MA in `…/prism-chart/prism-chart.component.ts` (`showMovingAverage`, `calculateMovingAverageData`); set line `tension` to 0 and remove `toggleSmoothing` / `smoothingLevel`.
- **UI-3.4** Remove "Moving Avg." in `new-line-chart/new-line-chart.component.ts` and `new-line-chart/type-specific/DefaultChart.ts` (check whether the component is still routed; delete if dead).
- **UI-3.5** Remove EMA: `fetchEmaData` / `ema-log` overlay in `sensor-chart-main.component.ts` and `default-chart.component.ts`; EMA toggle (`options.movingAverage`) in `new-line-chart/sensor-data.service.ts`.
- **UI-3.6** Prism chart: stop reading `daily::*` docs / `daily*` axes; use `smooth` on the raw axis names. For ranges > 90 days downsample `smooth` to one point per day client-side (median of the day) for performance.
- **UI-3.7** Styling: samples with `isReplay` → dashed/grey segment + legend "נתונים משוחזרים"; `suspect` hidden by default, visible with a debug toggle.
- **UI-3.8** Threshold lines on the smoothed series = warn/alarm (Tier 2). When raw is shown, also draw ±instant gap around the smoothed line (Tier 1 band).

### Phase 4
- **UI-4.1** Threshold settings: per axis add `instant.gap` (default alarm) and optional `rate` (gap + days). Show the sensor's **noise floor** (½ × daily swing + 4σ, computed from the last 30 days) next to the inputs and warn when a gap is below it.
- **UI-4.2** Alert list / alert detail: show tier icon (⚡/📈/🔧), smoothed vs raw value, persistence, and a chart snippet.
- **UI-4.3** Site-level switch `projects/{id}.alerting` (`v1` | `v2`) in admin settings for the per-site rollout.
- **UI-4.4** Sync `shared-status-types` from functions (FN-6.4).

**Acceptance:** on a pilot sensor, chart line == values in `smooth`, raw toggle works, no client-side averaging code remains (`grep -ri "movingAverage\|ema-log\|maWindowHours" src` → only removed/legacy-safe hits).

---

## 3. `scanin-svc-reports`

**Context:** Reports fetch raw `data-log` (downsampled) and, for prisms, plot the daily worker's `daily*` axes as "Processed" (`scripts/utils/sensorTypeAxes.js`). From Phase 2 every sample carries `smooth` (see "Shared contract"); reports must show the same series the UI and alerts use.

### Phase 5
- **REP-5.1** `scripts/services/firestoreService.js` / `prepareReportData.js`: read `smooth.<axis>` alongside raw; keep min-max downsampling but downsample the smoothed series with median-per-bucket (not min-max — min-max would re-introduce spikes).
- **REP-5.2** `scripts/utils/sensorTypeAxes.js`: replace `daily2Ddisplacement` / `dailySettlement` / `dailyEasting…` / `dailyNorthing…` "Processed" series with `smooth` on `TwoDDisplacement` / `HeightDisplacement` / `EastingDisplacement` / `NorthingDisplacement`; same for all other types (tilt, crack, …). Raw series optional (`showRaw`), faint.
- **REP-5.3** `scripts/services/chartService.js`: draw baseline-event markers (`baseline-events`), dashed segments for `isReplay`, skip `suspect`; threshold lines = Tier 2 warn/alarm.
- **REP-5.4** Legend/caption text (Hebrew): "ממוצע 24 שעות ללא חריגים; קווי הסף הם ספי ההתראה". If the period contains replayed data, add a footnote with the replayed date range.
- **REP-5.5** Health report (`prepareHealthReportData.js`, `renderHealthReport.js`): status from the new `status.axes`; show tier of the last alert.
- **REP-5.6** Sync `shared-status-types` (FN-6.4).

**Acceptance:** a pilot report's charts match the UI chart for the same sensor/period; no `daily*` field references left in `scripts/` except migrations.

---

## 4. `scanin-svc-mqtt-bridge` (incl. ATS live routing)

**Context:** On **2026-09-23**, 25 prisms in 4 JTCS sites (SAVYON_LIVING ×7, SAVYON_OFFICE ×3, NAVON_HOUSE ×11, NEVIIM_61 ×4) stepped by 0.1–1.2 m on the same day; some prisms (e.g. SAVYON_LIVING prism 3, NAVON 23/24) flip between levels ~8.9 m apart over months. That pattern means readings are written to the wrong sensor doc (mapping/ID), not building movement. Recent commits touched ATS routing (`ats-device-map routing with fallback`, carry-over for reassigned DeVinci-1 prisms, deterministic ATS sample IDs). Evidence: handbook `ops/src/analysis/level-shifts.ts`.

### Phase 0
- **BR-0.1** Investigate the 09-23 event: which deploy/config/`ats-device-map` change happened on 09-22/23; for 2–3 affected prisms compare the incoming payload's prism ID/name vs the target `work-sensors` doc. Write findings to `docs/` and the handbook (`docs/signal-and-alerts/findings-2026-09-23.md`).
- **BR-0.2** Investigate the ~8.9 m flip-flops (SAVYON_LIVING `3`, NAVON `23`, `24`): name collisions across stations/ATS devices? fallback routing picking the wrong prism?

### Phase 1
- **BR-1.1** Make prism → sensor mapping deterministic on a stable key (station/device + prism ID); no fuzzy/fallback match that can cross stations. Unmatched prism → write to `ats_raw_payloads` + internal notice, never to a guessed sensor.
- **BR-1.2** When the device map changes for a prism (reassignment), create a `baseline-events` doc `{ reason: 'mapping-fix' | 'ats-setup' }` for the target sensor (or call `setBaseline`).
- **BR-1.3** ATS run QA at ingestion: for each run, per prism deviation from its own last-3-days median; run common-mode = median deviation across prisms. If |common-mode| > max(3 mm, 4 × within-run spread) **and** ≥ 60% of the run's prisms deviate in the same direction → mark all run samples `suspect: true, suspect_reason: 'run-common-mode'` and log/notify internally (one notice per run). Port from handbook `ops/src/analysis/common-mode.ts`.
- **BR-1.4** Plausibility at ingestion for ATS: a prism moving > 100 mm vs its last sample → `suspect: true, suspect_reason: 'implausible-jump'` (functions also checks, defence in depth).
- **Acceptance:** replaying the 09-23 payloads in a test project routes every prism to its own sensor; a synthetic shifted run is marked suspect.

---

## 5. `scanin-svc-hexagon-ats-ingestion` (C#) and `scanin-fw-ats-monitoring`

**Context:** Same prism-identity and run-quality issues as section 4 apply to email-ingested ATS runs and the on-site ATS PC software. Whole runs can be shifted (e.g. DeVinci 2026-10-01 12:20: −13.6 mm across 23 prisms, within-run spread 1.3 mm) — a station/instrument issue, not structural movement.

- **ATS-0.1** Confirm whether 09-22/24 changes (e.g. "Estimate timestamps for no-email runs") affected sample times or prism attribution; contribute to BR-0.1 findings.
- **ATS-1.1** Same deterministic prism → sensor mapping rule as BR-1.1.
- **ATS-1.2** Same run QA as BR-1.3 (mark `suspect`), or tag each run with a `runId` on every sample so functions can do run QA centrally — pick one place, document it.
- **ATS-1.3** On station re-setup / instrument replacement, emit a baseline event for all prisms of that station (`reason: 'ats-setup'`).

---

## 6. `scanin-worker-prism-daily`

**Context:** Nightly (00:05 Asia/Jerusalem) it writes `daily::{date}::{axis}` docs (`daily2Ddisplacement`, `dailySettlement`, `dailyEastingDisplacement`, `dailyNorthingDisplacement`) using MAD rejection + speed gate + trimmed mean. Today it is the only robust prism smoothing, and UI/reports depend on it. In the new design its logic moves into the shared per-sample smoothing (`smooth` field) and the plausibility cap; this worker is retired.

- **PD-2.1** Keep running unchanged during Phases 2–4.
- **PD-2.2** Provide its config (`worker/shared/config.js`: `kMAD`, `maxSpeed_mm_per_hr`, `trimmedMeanPercent`, `minSamples`) and validation notes to the functions team (FN-1.1, FN-2.1).
- **PD-5.1** After REP-5.* and UI-3.6 are live: pause the Cloud Scheduler job `daily-prism-processing`; keep services deployed 2 weeks for rollback.
- **PD-6.1** Delete scheduler + Cloud Run services (`daily-prism-orchestrator`, `daily-prism-worker`); archive the repo. Historical `daily::*` docs: delete via functions cleanup script (**destructive, needs approval**) or keep read-only.

---

## 7. `scanin-tool-data-replay` (gap-fill / demo data)

**Context:** Replay/gap-fill and ad-hoc data copies rewrote history and triggered thousands of alerts (09-02: 6,234). From Phase 0 alerts ignore replay and rewrites, but replayed data must stay clearly marked and the smoothed series must be recomputed.

- **RP-0.1** Ensure every synthetic doc has `isReplay: true, source: 'replay'` (already in `scripts/lib/gapfill.js`); audit ad-hoc copy scripts (`copy-sensor-data.js`, `shift-range.js`, …) to set the same flags.
- **RP-2.1** After any `--apply` run, call `recomputeSmoothing({ sensorId, fromTime: windowStart − 24h })` for each touched sensor (add to `gap-fill.js` and the Cloud Run API job completion).
- **RP-2.2** Update `docs/prism-gap-fill-runbook.md`: new Step 4 = `recomputeSmoothing` (instead of / in addition to the prism-daily `rerunRange` until PD-6.1).
- **RP-5.1** Policy (decision pending, plan §8.5): whether replayed periods may appear in client reports; implement the agreed marking.

---

## 8. `scanin-worker-firestore-adjustments` (C#) and UI `data-handling-tools`

**Context:** These modify samples in place (corrections, recalibrations). After any modification the stored `smooth` values in the affected window are stale.

- **ADJ-2.1** After each adjustment job, call `recomputeSmoothing({ sensorId, fromTime: earliestTouched − 24h })` per sensor.
- **ADJ-2.2** If an adjustment is effectively a re-baseline (constant offset applied from a time onwards), use `setBaseline` instead of rewriting raw values.
- **ADJ-2.3** Same for handbook `ops/src/oneoff/*` scripts and `scanin-maintenance` recalibration scripts (document in their READMEs).

---

## 9. `scanin-svc-watchdog`

**Context:** The watchdog already checks alert delivery. It should also guard the new pipeline.

- **WD-0.1** New check `alerts-storm`: in the last hour, any sensor+axis with > 3 alerts, or > 200 alerts fleet-wide → critical (WhatsApp to ops). Logic as handbook `ops/src/analysis/alert-landscape.ts` "throttle-violating bursts".
- **WD-1.1** New check `integrity-backlog`: open internal `integrity` alerts older than 3 days → warning.
- **WD-2.1** New check `smoothing-coverage`: share of new samples (last 1h, active projects) without `smooth` > 5% → warning.

---

## 10. `scanin-handbook` (ops & docs)

- **HB-0.1** Keep `ops/src/analysis/*` as the regression suite; re-run `backtest.ts` and `alert-landscape.ts` after each phase and record results in `docs/signal-and-alerts/progress.md`.
- **HB-1.1** Produce the review list of "stuck" sensor-axes (smoothed beyond warn > 90% of the time) per site from `ops/out/backtest-*.json` for Nathan; track outcome (new baseline / threshold change / real movement).
- **HB-1.2** Update `docs/ops/runbook-index.md` and `AGENTS.md` when `setBaseline` / `recomputeSmoothing` exist.
- **HB-4.1** Client-facing explanation (Hebrew, 1 page): what the smoothed line means, the two alert types, what "confirmed by 2 readings" means.
