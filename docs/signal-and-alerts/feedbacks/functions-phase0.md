# Feedback: `scanin-svc-firebase-functions` — Phase 0 "Stop the bleeding" (FN-0.1 … FN-0.5)

**Date:** 2026-10-04
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Status:** implemented, all acceptance cases pass on the emulator, **not deployed**, changes uncommitted pending review.

---

## 1. What changed

| File | Change |
|---|---|
| `src/checkThresholds.ts` | **FN-0.1** trigger `.onWrite` → `.onCreate` on `work-sensors/{sensorId}/data-log/{entryId}` — updates/rewrites of existing samples never evaluate; deletes no longer invoke the function at all. **FN-0.2** `getSampleSkipReason()` runs before any Firestore read: `isReplay === true`, `source === 'replay'`, `suspect === true`, `source === 'derived:daily'`, `time < now − 48h` — each skipped with a `logger.info` naming the reason (the 48h skip logs the sample's age in hours, so late buffered uploads are visible/countable in Cloud Logging). **FN-0.3** `analyzeSample` rewritten around `db.runTransaction`: sensor-doc read → evaluate → write of `status.axes` + `alert_state` + alert docs (via `tx.set` on pre-made refs) is atomic, so concurrent samples of one sensor can't race past the throttle. The out-of-order guard (`time < alert_state.last_sample_time`, strict `<` for devices writing each axis as a separate doc with the same time) runs inside the transaction; `last_sample_time = max(existing, sample.time)` is written on **every** evaluation. **FN-0.4** `createNewAlertObject` adds `sampleTime` (the sample's `time`). **FN-0.5** per-level throttle (below). EMA computation preserved, moved inside the transaction. Daily alert-metrics increment stays post-commit. |
| `src/shared-status-types/shared-types.ts` | New `PerLevelAlertTimes { warn, alarm }`; `AxisAlertState.last_alert_at: PerLevelAlertTimes \| number \| null` (legacy single number documented); `SensorAlertState.last_sample_time?: number`; `BaseAlert.sampleTime?: number`. |
| `src/shared-status-types/threshold-helpers.ts` | New `normalizeLastAlertAt(lastAlertAt, lastLevel)` — normalizes any stored shape to `PerLevelAlertTimes`. |
| `scripts/test-phase0-emulator.js` | New acceptance-test script; refuses to run unless `FIRESTORE_EMULATOR_HOST` is set. |
| `tsconfig.json` | Unrelated housekeeping: explicit `rootDir: "./src"`, removed deprecated `baseUrl` (TS 7 readiness; output layout verified unchanged with a clean rebuild). |

### Final `alert_state` shape

```jsonc
{
  "last_sample_time": 1791118769048,   // ms; written on every evaluation, never moves backwards
  "axes": {
    "<axis>": {
      "last_level": "warn",
      "last_alert_at": { "warn": 1791118759000, "alarm": null }   // NEW per-level shape
    }
  },
  "communication": { ... },                        // untouched
  "min_hours_between_same_level_alerts": 24
}
```

**Legacy handling:** a numeric `last_alert_at` is read as belonging to `last_level` **only** (so a legacy warn timestamp never throttles an alarm escalation); the first new alert/settle rewrites it in the per-level shape. Throttle check targets the **new** level's timestamp → escalation always alerts, a repeat of the same level within 24h is throttled.

---

## 2. Acceptance testing

Firestore + Functions emulator (`--project demo-scanin`, offline), via `scripts/test-phase0-emulator.js`. **13/13 checks passed:**

| # | Case | Result |
|---|---|---|
| 1 | Rewrite existing `data-log` docs (update + overwrite-`set` with alarm-crossing values) | **0 alerts** ✅ |
| 2 | New docs with `isReplay: true` / `source: 'replay'` / `suspect: true` crossing alarm | **0 alerts**, each with its own SKIP log ✅ |
| 3 | New real doc crossing warn → **1 alert** (severity `warn`, `sampleTime` == sample.time); crossing alarm 1s later → **1 more alert** (2 total). Settle→re-warn within 24h → throttled (still 2) ✅ |
| 3b | Simulated **legacy** state (numeric `last_alert_at`, warn 1h ago): warn→alarm escalation still alerted ✅ |
| 4 | 10 concurrent warn-crossing docs | **exactly 1 alert** (transaction losers re-read warn status; retries visible in logs) ✅ |
| + | Out-of-order sample (`time` < last evaluated) and 49h-old sample | both skipped with info logs (`stale sample: 49.0h old (>48h cutoff…)`) ✅ |

Verified in logs: all five skip reasons appear as `SKIP: Sensor <id> | sample time=<t> not evaluated — <reason>`.

`npm run build` and `npm run lint` pass (3 pre-existing console warnings in an unrelated root script).

---

## 3. Deviations & findings

1. **Write volume:** storing `last_sample_time` on every evaluation ≈ one sensor-doc write per sample (previously only on status change / EMA). Fine for Firestore limits at current sample rates, but it is a billing/write-amplification change.
2. **DIN path (`evaluateDinSensor`)** untouched except: (a) it now benefits from `onCreate` + the sample-field guards (shared trigger), and (b) a type coercion for the `last_alert_at` union — DIN still reads/writes its own single-number shape on the `din` axis and runs **outside** the transaction, as before. The out-of-order / `last_sample_time` guard does **not** apply to DIN or `vibration_vf`.
3. **Other `data-log` writers reviewed:** `calcSensors.ts` creates new docs for virtual sensors (no `source` flag) → still evaluates under onCreate, same as today. `recalcEma` / `processDataRequest` only read; `deleteAtsRun` deletes (no longer triggers anything).
4. **`alert_state` readers elsewhere:** only migration scripts (reports repo) and the mirrored type file in web-platform — no live reader of `last_alert_at` outside functions, so the shape change is safe. `shared-status-types` mirrors in web-platform/reports compile independently; sync deferred (see questions).
5. Transaction retries can duplicate ALERT/THROTTLED log lines under contention — commit happens once; log noise only.

---

## 4. Deploy status & rollback

- **Not deployed.** Deploy (after approval): `npm run deploy` as `scanin.link@gmail.com` (predeploy runs lint + build).
- **Rollback:** redeploy the previous commit — the trigger reverts cleanly (onCreate↔onWrite). The new `alert_state` fields are additive; old code treats the per-level object as "never alerted", so a rollback briefly restores the old per-axis throttle semantics but nothing breaks.
- Changes are **uncommitted** in the repo pending review.

---

## 5. Open questions

1. **ATS late arrivals:** the 48h cutoff + out-of-order guard also suppress alerts from late-ingested ATS runs. <48h late is fine; a station offline >2 days will produce silent samples until a fresh one arrives. Acceptable?
2. **Type sync:** push the `shared-status-types` changes (`PerLevelAlertTimes`, `last_sample_time`, `sampleTime`) to web-platform and reports now, or defer to FN-6.4 as planned?
3. **`last_sample_time` write volume:** keep as specced (every sample), or throttle the write (e.g., only when it advances >N minutes)?
4. **Prod verification:** after deploy, do you still want a live test on a "בדיקות משרד" sensor (replay docs + one real-shaped doc), or is the emulator run sufficient?

---

## Handbook review (2026-10-04)

Code read in `src/checkThresholds.ts`: matches spec. Answers, backed by `ops/src/analysis/ingest-lag.ts --days=30` (22 active projects, 50,361 non-replay samples):

1. **Accept the 48h cutoff.** 12% of samples arrive >48h late (ATS live: 0; max lag 0.6h). They come from two patterns:
   - **Bulk catch-ups after an outage**, e.g. City of David cracks (403 docs on 09-22 08h covering 09-04 → 09-22) and NAVON tilts (367 docs on 09-24 07h covering 09-09 → 09-24). This is exactly the storm pattern; evaluating only the last 48h is right.
   - **Slow buffer drain**: צייטלין 12 tilt 4 / 5 (pilot site) offline since 09-06, then draining ~50–100 samples per 6h since 09-21, still ~5 days behind. Every sample is skipped. A client alert 5 days late isn't useful anyway; what's missing is an **internal "sensor N days behind" notice** → added as a Phase 1 item (FN-1.6).
2. **Defer type sync** to FN-6.4 (no live reader).
3. **Keep the write on every sample.** Phase 2 needs per-sample evaluator state anyway (`alert_state.axes.<axis>.ref`).
4. **Yes, a short live test** on a "בדיקות משרד" sensor with no client subscribers: one `isReplay` doc + one real-shaped doc crossing warn. Then watch the logs for 24h and run `alert-landscape.ts --since=7d` after a week.
