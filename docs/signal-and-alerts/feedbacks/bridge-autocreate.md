# Feedback: `scanin-svc-mqtt-bridge`: auto-created ATS sensors (no thresholds + `ats-setup` baseline event)

**Date:** 2026-10-05
**Repo:** [scanin-svc-mqtt-bridge](https://github.com/ScanInLtd/scanin-svc-mqtt-bridge)
**Status:** implemented and emulator-tested, **not committed, not deployed**. Waiting for Hillel's approval (see §5).
**Trigger:** on 2026-10-05 Nathan re-taught many DeVinci points. The bridge auto-created 48 `ATS.DeVinci-1.*` sensors with the default 4/6 mm thresholds on E/N/H/TwoD. With v2 alerts and `prismAxes=registry`, they produced 50 of the day's 53 alerts before anyone mapped them.

---

## 1. What changed

| File | Change |
|---|---|
| `src/services/firestoreService.js` | `createAtsSensorAndMap`: the sensor is created with **`thresholds: { axes: {} }`** and `confirmed: false`. `initial-value` is still seeded from the first sample. In the **same transaction** it now also writes `work-sensors/{id}/baseline-events/{autoId}`. The 4/6 mm default constants and `buildAtsDefaultThresholdAxes()` (export included) are removed; nothing else used them. `createAtsSensorAndMap` and `findOrCreateAtsSensor` take a new last argument, `firstSampleTimeMs`. |
| `src/handlers/scaninHandler.js` | `processAtsSample` passes `timestamp * 1000`, the sample's own time. |

Baseline event shape (matches the shared contract in `tasks.md` and functions `setBaseline.ts`):
```jsonc
{ "time": 1790000000000,            // first sample time (payload.timestamp × 1000), = its data-log doc id
  "reason": "ats-setup",
  "initial": { "EastingDisplacement": 1.5, "NorthingDisplacement": -2, "HeightDisplacement": 0.25, "TwoDDisplacement": 2.5 },
  "by": "bridge",
  "note": "auto-created for ATS-5-f4p4",
  "createdAt": 1791232596462 }      // Date.now() number, same as setBaseline
```

**Untouched:**
- Existing sensors. The event and thresholds are written only on the branch that creates a new sensor.
- The routing (map → legacy fallback → create).
- `storeAtsSample`.

## 2. Why `axes: {}` stops alerts

In `checkThresholds.ts`, `evalAxes = Object.keys(sensorData.thresholds?.axes || {})…`, and nothing is evaluated without an entry there. The axis registry adds no default gaps, only `alertable` / `suspectJump` / labels (`axisRegistry.ts`). So for an auto-created sensor:
- no threshold evaluation and no alerts;
- no smoothing and no suspect check (both run only over `evalAxes`);
- `detectLevelShifts` skips it, since it needs warn gaps.

Once someone sets thresholds in the UI, evaluation starts. The baseline event is already in place, so the smoothing window starts at the first sample.

The handbook-era script `scripts/backfill-ats-sensor-defaults.js` adds 4/6 mm only where `thresholds.axes` is **missing**. `{}` counts as present, so re-running that script won't undo this change.

## 3. Verification

`npm test` is a stub, so I wrote a throwaway script (`/tmp`, deleted afterwards). It ran the real `firestoreService.js` against the local **Firestore emulator** on Node 20, with a fake key and no prod access. **All passed:**
- Two **concurrent** first samples for one device produce one sensor, one map entry, and **exactly one** baseline event. The losing transaction routes to the existing sensor.
- The sensor has `thresholds: { axes: {} }`, `confirmed: false`, and `initial-value` from the first sample (TwoD = hypot(E, N)).
- The event has `time` = first sample ms, `reason` `ats-setup`, `initial` equal to `initial-value`, `by` `bridge`, the note, and a numeric `createdAt`.
- A later sample for the same device routes via the map. No new event is written and the sensor is unchanged.
- An already mapped (existing) sensor keeps its thresholds and gets no baseline event.

`node --check` is clean for both files.

## 4. Not addressed (flagging)

- **The 48 sensors created on 10-05 still have 4/6 mm thresholds.** You said not to touch existing sensors, so I didn't. If they shouldn't alert until mapped, a oneoff (dry-run → you `--apply`) could set `thresholds.axes = {}` and add the `ats-setup` event for `dataSource == 'ats_live' && confirmed == false && created >= 2026-10-05`.
- **`cleanUnconfirmedSensors`** (functions, daily) deletes `confirmed: false` sensors older than 7 days. It removes the sensor doc but leaves the map entry and the data-log (findings-2026-09-23 §4). The 10-05 sensors will hit this around **10-12** unless they're mapped/confirmed first. After that the bridge writes into deleted docs. This change keeps `confirmed: false` as you asked, so the risk is unchanged until BR-1.1 (or a functions guard).
- `location.site` is still the raw `siteId` (`"DeVinci-1"`), not a project ID, so these sensors aren't visible under any project. That's BR-1.1 ("unassigned" list).
- Later (not done): BR-1.1 (no auto-create, unassigned list) and ATS-1.3 (station re-teach event → baseline event), per `tasks.md` §4/§4b.

## 5. Deploy (after approval)

The VM's `deploy.sh` runs `git pull origin master`, so the change must be **committed and pushed** first:
1. Locally: commit both files (proposed message: `fix(ats): auto-created ATS sensors get no thresholds and an ats-setup baseline event`) and `git push origin master`.
2. On `monitoring-bridge-vm`: `cd ~/monitoring-bridge && ./deploy.sh`, then `bridge-log`.
3. Check: the next auto-created sensor logs `Created new ATS sensor and map…`. Its doc has `thresholds.axes == {}`, and `baseline-events` has one `ats-setup` doc.
