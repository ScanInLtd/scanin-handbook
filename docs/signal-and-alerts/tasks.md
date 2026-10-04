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
  // written back by functions in ONE update per sample, never by clients:
  // n = samples used; replayN = replay docs in the window (EXCLUDED from the
  // computation); q = six-hour DAY quarters covered (3–4, diurnal coverage,
  // folded mod 24h); w = window hours (24, prisms 48 — plan §8.1)
  "smooth": { "<axis>": 0.121, "n": 23, "replayN": 0, "q": 4, "w": 24, "v": 1 },   // Phase 2
  "eval":   { "<axis>": "ok | warn | alarm | suspect" }             // Phase 2 (shadow), authoritative from Phase 4
}
```
Raw fields, `time`, `source`, `isReplay` are written once at ingestion and never modified. `suspect` / `suspect_reason` may be set by ingestion (ATS run QA) or by functions (plausibility).

**Baseline event** — `work-sensors/{id}/baseline-events/{autoId}` (Phase 1):
```jsonc
{ "time": 1790000000000, "reason": "replaced|moved|rebaseline|mapping-fix|ats-setup|migration",
  "initial": { "<axis>": -0.923 }, "by": "uid or email", "note": "free text", "createdAt": 1790000000000 }
```
Adjusted value of a sample = raw − `initial` of the **latest event with `time ≤ sample.time`**. `work-sensors/{id}.initial-value` mirrors the latest event during migration (read by legacy code only).

**Smoothing (v1)** — for each new sample, per axis with thresholds:
1. Window = samples with `time ∈ (t − W, t]` where W = 24h (prisms: 48h, plan §8.1), after the latest baseline event, excluding `suspect: true`.
2. Reject values with |v − median| > 3 × MAD (MAD = median absolute deviation; skip rejection if MAD = 0).
3. Trimmed mean of the remaining values, dropping 20% from each end.
4. Require n ≥ max(3, ¼ × expected samples per window); else no `smooth` value for that axis.
5. Diurnal coverage: the kept samples must cover ≥ 3 of the 4 six-hour quarters of the DAY — offsets from window start folded mod 24h (exact day-boundary offsets, incl. the trigger sample, belong to quarter 3); else no `smooth` for that axis.
6. Store **adjusted** smoothed value (raw − baseline) in `smooth.<axis>`, plus `n`, `replayN` (replay docs in the window, excluded from the computation), `q` (quarters covered), `w` (window hours), `v: 1`.
7. Prisms (FN-2.5): E/N are smoothed too and stored; `smooth.TwoDDisplacement = hypot(smooth.E, smooth.N)`; adjusted TwoD = `hypot(E − E0, N − N0)`. Prisms with a TwoD initial but no E/N initials keep the legacy raw − initial behavior until the ATS repair.

**Alert doc** — `alerts/{id}` gains:
```jsonc
{ "tier": "instant | confirmed | rate", "smoothValue": 0.121, "baseline": 0.12,
  "persistedHours": 6, "confirmations": 2, "sampleTime": 1790859605752 }
```
`alerts` is **client-facing only**. Internal notices never go there, because `handleAlerts` sends every new `alerts` doc to subscribed users.

**Internal notice** — `data-integrity/{autoId}` (new collection; written by functions and the bridge, never sent to clients):
```jsonc
{ "kind": "implausible-jump | out-of-range | level-shift | late-data | run-common-mode | identity-mismatch | unrouted",
  "severity": "warning | critical",
  "status": "open | resolved",
  "dedupeKey": "implausible-jump:<sensorId>:<axis>",   // one OPEN doc per key
  "sensorId": "…", "projectId": "…", "axis": "y",       // projectId = sensor location.site
  "message": "Prism 3 @ SAVYON: jump +8,866 mm vs last good value — mapping / device move?",
  "details": { "value": 8866.1, "ref": 0.4, "limit": 100, "sampleTime": 1790859605752 },
  "openedAt": <ts>, "lastSeenAt": <ts>, "count": 14,   // repeats increment count, no new doc
  "resolvedAt": null, "resolvedBy": null,
  "resolution": null,                                   // baseline | mapping-fix | released | ignored | auto
  "notifiedAt": null }                                  // set by the later WhatsApp sender
```
- Writers use one helper `raiseIntegrity({kind, sensorId, axis, …})`: in a transaction, find the open doc by `dedupeKey`. If found, bump `count` and `lastSeenAt`; otherwise create one.
- `resolveIntegrity(dedupeKey, resolution, by)` closes it: called by `setBaseline` (`baseline`), by the future UI (`released` / `ignored`), or automatically when the condition clears (`auto`, e.g. late-data caught up).
- Needs a composite index on `dedupeKey` + `status`.
- **Later (not Phase 1):** a WhatsApp sender on `data-integrity` onCreate, configured by `system-config/data-integrity` `{ enabled, whatsappGroup, minSeverity }`, plus a UI page (UI-1.3).

**Sensor config** — `work-sensors/{id}.thresholds.axes.<axis>` (one ladder, plan §4.5) gains optional:
```jsonc
{ "warn": {"gap": 0.1}, "alarm": {"gap": 0.2},       // Tier 2, on smooth
  "instant": {"gap": 1},                     // Tier 1, raw jump vs last good smooth; default = alarm.gap
  "suspect": {"jump": 2, "abs": 15},         // QC: raw jump vs last good smooth / |raw adjusted|; default per type
  "rate": {"gap": 0.03, "days": 7} }         // optional Tier-2 rate rule
```
Order must hold: `warn < alarm ≤ instant < suspect.jump`. Per-type defaults for `suspect.jump` (code constant, tune with `signal.ts`): tilt 1°, crack 5 mm, prism 100 mm.

**Evaluator memory** — `work-sensors/{id}.alert_state` (functions only, updated in a transaction):
```jsonc
{ "last_sample_time": 1790859605752,
  "axes": { "<axis>": {
      "level": "warn",                                 // last alerted level (Tier 2)
      "candidate": { "level": "alarm", "since": 1790850000000, "count": 2 },  // Tier 2 pending confirmation
      "ref": 0.121,                                    // last good smoothed value (for instant / suspect jumps)
      "instantPending": { "value": 1.3, "time": 1790859605752 },  // Tier 1 waiting for next sample
      "suspectSince": null,                            // set while the axis sits at a suspect level
      "last_alert_at": { "warn": 1790000000000, "alarm": null } } } }  // per level (Phase 0 throttle fix)
```

---

## 1. `scanin-svc-firebase-functions` (core)

**Context:** `checkThresholds` (`src/checkThresholds.ts`) runs `onWrite` on every `data-log` write and compares the raw adjusted value of a single sample against ±warn/alarm, with a 24h throttle in `alert_state`. In the last 60 days 84% of all alerts (6,552 / 7,763) came from rewrites of historical data (copy/replay/gap-fill jobs) that re-triggered it, with concurrent invocations racing past the throttle. Remaining alerts are dominated by noise. This repo owns the new evaluation pipeline. Read "Shared contract" above.

### Phase 0 — stop the bleeding
- **FN-0.1** Change `checkThresholds` trigger from `.onWrite` to `.onCreate` (`functions.firestore.document("work-sensors/{sensorId}/data-log/{entryId}").onCreate`). Updates to existing samples must never evaluate.
- **FN-0.2** Early-return (log at info) when: `isReplay === true` || `source === 'replay'` || `suspect === true` || `source === 'derived:daily'` || `time < Date.now() − 48h` || `time < sensor.alert_state.last_sample_time` (out-of-order / backfill; strict `<` because some devices write each axis as a separate doc with the same `time`). Store `alert_state.last_sample_time` on each evaluation.
- **FN-0.3** Wrap the read-evaluate-write of `status.axes` + `alert_state` + alert creation in `db.runTransaction` so concurrent samples of one sensor can't double-alert.
- **FN-0.4** Add `sampleTime` (the sample's `time`) to alert docs (`createNewAlertObject`) — currently only creation time is stored, which hides backfill storms.
- **FN-0.6** `cleanUnconfirmedSensors`: skip sensors that are a target in `ats-device-map` or have `dataSource: 'ats_live'`. Today it deletes the sensor doc only, so the map entry keeps routing data into a deleted sensor's `data-log` (findings §4). **Deadline: before 2026-10-11** (11 `ATS-5-f*` sensors auto-created on 10-04).
- **FN-0.5** Throttle per **level**, not per axis: `canSendAlert` today uses one `last_alert_at` per axis, so a warn alert suppresses an alarm alert within 24h (status changes to alarm, nobody is notified). Store `last_alert_at` per level; an escalation always alerts.
- **Acceptance:** run a test replay on a test sensor (`בדיקות משרד` project) → 0 alerts. Handbook `alert-landscape.ts --since=7d` shows ≈0 "throttle-violating bursts".

### Phase 1 — data correctness & baseline events
- **FN-1.1** Plausibility level (`thresholds.axes.<axis>.suspect`, fallback to per-type defaults). Evaluated first: |raw adjusted − `alert_state.axes.<axis>.ref`| > `suspect.jump`, or |raw adjusted| > `suspect.abs` → update the sample with `suspect: true, suspect_reason: 'implausible-jump' | 'out-of-range'` (allowed: alerts are onCreate only) and `raiseIntegrity({ kind: 'implausible-jump' | 'out-of-range', severity: 'critical' })`, one open doc per sensor+axis (`suspectSince`). `ref` is not updated from suspect samples, so a sensor stuck at a wrong level keeps being flagged until a baseline event / mapping fix / manual release. **Ship together with FN-2.1**: `ref` is the last good `smooth` value, so there is no interim reference.
- **FN-1.2** Baseline events: implement adjusted-value lookup per the contract (cache latest events per sensor in the invocation). Callable `setBaseline({ sensorId, time?, reason, note, initial? })` (admin/installer only): if `initial` omitted, compute it as the median of raw values in the 24h after `time`; write the event, mirror into `initial-value`, reset `alert_state` and `status.axes` to `ok` for that sensor.
- **FN-1.3** Migration script (`scripts/`, dry-run by default): for every sensor create one `baseline-events` doc `{ reason: 'migration', time: <first sample time>, initial: <current initial-value> }`.
- **FN-1.4** Scheduled `detectLevelShifts` (daily 02:00 Asia/Jerusalem): per active sensor (project `isActive`), daily medians of the last 7 days; a step > 3 × warn gap that persists ≥ 2 days → `raiseIntegrity({ kind: 'level-shift', severity: 'warning' })`, message "possible device move / replacement / mapping change — set a new baseline". Port logic from handbook `ops/src/analysis/level-shifts.ts`.
- **FN-1.5** `data-integrity` collection per the contract: `raiseIntegrity` / `resolveIntegrity` helpers (`src/integrity/`), composite index (`dedupeKey`, `status`), Firestore rules (admin read only, no client writes). No delivery yet: the collection is the inbox (read with handbook `./go.sh`, later the UI page and WhatsApp). `handleAlerts` is unchanged.
- **FN-1.6** Late-data notice: when samples of a sensor arrive > 48h late (skipped by FN-0.2) → `raiseIntegrity({ kind: 'late-data', severity: 'warning' })`, "‹sensor› is ‹N› days behind (buffered upload)"; auto-resolve when a sample < 1h late arrives. Evidence: handbook `ingest-lag.ts` (צייטלין 12 tilt 4/5 drained a backlog ~5 days behind for 2 weeks; every sample skipped).
- **Acceptance:** 09-23-type prism jumps produce one internal notice per sensor, no client alerts; `setBaseline` round-trip tested on a test sensor.

### Phase 2 — smoothing in shadow
- **FN-2.1** In the onCreate evaluator compute `smooth` and the shadow `eval` per the contract and write them back with the QC flag in one update (`snapshot.ref.update({ smooth, eval, ... })`). Maintain `alert_state.axes.<axis>.ref`. Alerts unchanged in this phase.
  - Order per sample: (1) suspect check vs the stored `ref`; (2) window query of the last 24h, excluding suspect samples; (3) compute `smooth`; (4) update `ref = smooth` **only if** this sample isn't suspect and `smooth` exists.
  - `ref` is persisted and never expires. Otherwise, after 24h of wrong-level samples the window would be empty, there'd be no reference, and the wrong level would pass.
  - `ref` is missing on a sensor's first evaluation, so seed it from the `smooth` computed on that sample's window. History already exists in `data-log`, so no backfill is needed for this.
- **FN-2.2** Callable/HTTP `recomputeSmoothing({ sensorId, fromTime })` (admin): replays samples from `fromTime` in order, rewrites `smooth` fields in batches of 400. Never alerts, never touches raw fields. Called by: baseline events (FN-1.2), replay tool, adjustments worker.
- **FN-2.3** Backfill 90 days for pilot sites, then all active projects.
- **FN-2.5** Prism `TwoDDisplacement` is a magnitude (bridge: √(de² + dn²)), so "raw − initial" is wrong for it, and averaging magnitudes is biased upward. Derive it instead:
  - adjusted TwoD = hypot(E − E₀, N − N₀);
  - smoothed TwoD = hypot(smooth.E, smooth.N), so smooth E and N even when they have no thresholds;
  - E₀ and N₀ come from the baseline `EastingDisplacement` / `NorthingDisplacement`.
  This changes live raw-rule alerts for prisms with non-zero initials (e.g. NAVON 24: initial TwoD 9,232 mm). Produce a before/after comparison of the latest sample per prism before deploying.
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
  - (internal notices are not alerts; see `data-integrity`)
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
- **UI-1.1** "Set new baseline" action on the sensor page (admin only — there is no installer role): reason (replaced / moved / rebaseline / mapping-fix / ats-setup), optional time, note → calls `setBaseline` callable. Replaces direct editing of `initial-value` in sensor settings (keep the field read-only, showing the current baseline).
- **UI-1.2** Baseline-event markers (vertical line + tooltip with reason, who, when) on all sensor charts.
- **UI-1.3** (later) Admin page over `data-integrity` (open first; implausible jumps, level shifts, late data, bad ATS runs) with link to the sensor, a "set new baseline" shortcut and a "release (real movement)" action.
- **UI-1.4** Threshold settings: per axis add `suspect.jump` / `suspect.abs` (placeholder shows the per-type default); validate the ladder order `warn < alarm ≤ instant < suspect.jump`.

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

**Context:** Phase 0 findings: [`findings-2026-09-23.md`](./findings-2026-09-23.md). Three separate causes:
- **A, station frame error.** ATS-6 publishes whole cycles in a rigidly wrong frame: 09-08 → 09-15, and from 09-23 06:00Z on, **still ongoing**. 40 sensors in 6 projects are affected. This is not routing.
- **B, point name ↔ physical prism mismatch at the station.** These are the ~8.9 m flip-flops. Ingestion routes faithfully by name.
- **C, `ats-device-map` errors.** The 08-27 manual edits left swapped and crossed entries and two devices writing into one sensor. Some entries point at sensors that `cleanUnconfirmedSensors` deleted, so their data is invisible.

The fallback routing was not involved.

### Phase 0
- **BR-0.1 / BR-0.2** ✅ done, see findings.

### Phase 1
- **BR-1.1** Deterministic routing:
  - Map key `{stationId}:{pointId}` (read legacy `{deviceId}` docs during migration).
  - Store `atsSiteId` + `projectId` on the map doc and require `payload.siteId === map.atsSiteId`.
  - **Remove** the `findAtsSensor` fallback and `createAtsSensorAndMap` auto-create.
  - Unmatched point, site mismatch, or a map entry pointing at a missing / `active: false` sensor → `storeRawPayload(…, 'unrouted-sample')` + one `data-integrity` notice (`kind: 'unrouted'`) per device. Never write to a guessed or new sensor.
  - New points are mapped explicitly in the UI, which sets `confirmed: true`.
- **BR-1.2** Map edits create a `baseline-events` doc (`mapping-fix` | `ats-setup`). One sensor ↔ at most one device: enforce in the UI, check in the bridge at startup and notify on duplicates.
- **BR-1.3** Identity guard per sample. Store `refPos {e,n,u}` on the map entry (median position when mapped). If |pos − refPos| > 0.5 m, don't write to the sensor: store raw + `identity-mismatch` notice. Catches B and C, and A when the error is large.
- **BR-1.4** Run QA for frame errors < 0.5 m. Group by station + 45 min cycle window. If most points shift coherently (rigid-fit residual < 5 mm, large translation or rotation) → mark all samples of the cycle `suspect_reason: 'run-common-mode'`, one notice per cycle. Reference implementation: handbook `ats-frame.ts`.
- **BR-1.5** Plausibility at ingestion: jump > 50 mm vs the point's last-3-days median → `suspect: true, suspect_reason: 'implausible-jump'` (functions FN-1.1 also checks, defence in depth).
- **Acceptance:** replay the `ATS-6` payloads from 09-22 21:00Z → 09-24 03:30Z into a test project:
  - every point lands on its own sensor;
  - the swapped and crossed points land correctly;
  - the bad cycles from 09-23 06:02Z on are marked `run-common-mode`;
  - points with dangling map entries go to `ats_raw_payloads` with a notice.

### Repair (oneoff scripts in handbook `ops/src/oneoff/`, dry-run → user `--apply`; after A is stopped at the station)
- **BR-R.1** Mark `ats_live` samples of the 40 sensors in the bad cycles `suspect: true, suspect_reason: 'station-frame'`. No value correction.
- **BR-R.2** Fix the map entries (findings §7.3), copy samples from the swapped / orphaned sensors to the correct ones (original doc IDs), and mark the wrong copies `suspect_reason: 'mapping-fix'` (not deleted).
- **BR-R.3** Hexagon-era identity flips: mark samples > 0.5 m from the sensor's reference position `suspect_reason: 'identity-mismatch'`. Then review the masking `initial-value`s with Nathan.
- **BR-R.4** Re-run prism-daily `rerunRange` for the affected days. Re-run `level-shifts.ts` and `ats-crossmap.ts` to verify.

---

## 4b. `scanin-fw-ats-monitoring` (station PC software)

- **ATS-0.1** (ops, now) ATS-6 resection: pull RMS / references / residuals for 09-08 ~11:00Z and 09-23 03:00–06:00Z, fix the station frame, and confirm with `ats-frame.ts` that new cycles are good. Also check DeVinci ATS-5 (RMS 23.4 mm on cycle 214, 10-04).
- **ATS-1.1** Station-side frame check: if, after resection, the monitored points show a coherent common-mode shift, hold the cycle as suspect and don't publish it as good.
- **ATS-1.2** Add `cycleId`, `resectionRms`, `refsUsed` and per-reference residuals to each sample's `metadata` (input for BR-1.4).
- **ATS-1.3** Fix duplicate and wrongly taught points in the ATS-6 point list (findings §3). The real prism for SAVYON_LIVING 12 and NAVON 23 / 2 needs field verification.

---

## 5. `scanin-svc-hexagon-ats-ingestion` (C#) — **deferred**

Deprecated, non-critical path; out of scope for this plan. If it stays alive, its samples still pass the functions-side checks (FN-0.2, FN-1.1). Revisit only if email-ingested runs cause problems.

---

## 6. `scanin-worker-prism-daily` — **stop, no migration**

No logic hand-off: the shared smoothing (FN-2.1) and plausibility cap (FN-1.1) are specified independently.

- **PD-5.1** Keep running unchanged until UI-3.6 **and** REP-5.2 are live (prism chart and reports read `daily::*` until then). Then stop the Cloud Scheduler job `daily-prism-processing`, delete the Cloud Run services (`daily-prism-orchestrator`, `daily-prism-worker`) and archive the repo.
- Historical `daily::*` docs: keep read-only; deletion is a Phase 6 decision (**destructive, needs approval**).

---

## 7. `scanin-tool-data-replay` (gap-fill / demo data) — **later**

Phase 0 (FN-0.1/0.2) already stops replays from alerting. The items below follow once `recomputeSmoothing` exists; until then, avoid replay runs on pilot sites or re-run FN-2.3 backfill for the touched sensors manually.

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

## 9. `scanin-svc-watchdog` — **later**

**Context:** The watchdog already checks alert delivery. It should also guard the new pipeline. Not blocking any phase; until then, run handbook `alert-landscape.ts --since=7d` manually after each phase.

- **WD-0.1** New check `alerts-storm`: in the last hour, any sensor+axis with > 3 alerts, or > 200 alerts fleet-wide → critical (WhatsApp to ops). Logic as handbook `ops/src/analysis/alert-landscape.ts` "throttle-violating bursts".
- **WD-1.1** New check `integrity-backlog`: open `data-integrity` docs older than 3 days → warning.
- **WD-2.1** New check `smoothing-coverage`: share of new samples (last 1h, active projects) without `smooth` > 5% → warning.

---

## 10. `scanin-handbook` (ops & docs)

- **HB-0.1** Keep `ops/src/analysis/*` as the regression suite; re-run `backtest.ts` and `alert-landscape.ts` after each phase and record results in `docs/signal-and-alerts/progress.md`.
- **HB-1.1** Produce the review list of "stuck" sensor-axes (smoothed beyond warn > 90% of the time) per site from `ops/out/backtest-*.json` for Nathan; track outcome (new baseline / threshold change / real movement).
- **HB-1.2** Update `docs/ops/runbook-index.md` and `AGENTS.md` when `setBaseline` / `recomputeSmoothing` exist.
- **HB-4.1** Client-facing explanation (Hebrew, 1 page): what the smoothed line means, the two alert types, what "confirmed by 2 readings" means.
