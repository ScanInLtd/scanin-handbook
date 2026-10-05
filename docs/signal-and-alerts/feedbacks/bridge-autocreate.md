# Feedback: `scanin-svc-mqtt-bridge`: auto-created ATS sensors (registry thresholds + `ats-setup` baseline event)

**Date:** 2026-10-05
**Repo:** [scanin-svc-mqtt-bridge](https://github.com/ScanInLtd/scanin-svc-mqtt-bridge)
**Status:** implemented, emulator-tested, committed **`4450a5b`** and pushed to `master`. **VM deploy waiting for Hillel's approval** (§5).
**Trigger:** on 2026-10-05 Nathan re-taught many DeVinci points. The bridge auto-created 48 `ATS.DeVinci-1.*` sensors with 4/6 mm thresholds on E/N/H/TwoD. With v2 alerts and `prismAxes=registry` they produced 50 of the day's 53 alerts. The cause was points still being set up (f4p7 etc. went 0 → 10/40/−97 mm within a day while being re-aimed), not the thresholds themselves.

**Rule (Hillel, revision 1):** auto-created points **do** get thresholds, since dozens of prisms share the same values. They stay `confirmed: false` and **don't alert until confirmed**. That suppression lives in functions + UI, not in the bridge.

---

## 1. What changed

| File | Change |
|---|---|
| `src/services/firestoreService.js` | `buildAtsDefaultThresholdAxes()` is now async and reads the axis registry `devices-types/sensors/devices/prism`. In `createAtsSensorAndMap`: thresholds come from that function; `confirmed: false` and `initial-value` from the first sample are unchanged; a `baseline-events` doc (`ats-setup`) is written **in the same transaction** as the sensor and the map entry. `createAtsSensorAndMap` / `findOrCreateAtsSensor` take a new last argument, `firstSampleTimeMs`. |
| `src/handlers/scaninHandler.js` | `processAtsSample` passes `timestamp * 1000`, the sample's own time and data-log doc ID. |

**Threshold rule:**
1. Read `prism.defaultThresholds` = `{ <axis>: { warn: { gap }, alarm: { gap } } }`.
2. Keep an axis only if the registry marks it `axes.<axis>.alertable === true`. If the registry has no `axes` map, everything except `TwoDDisplacement` counts as alertable. Both `warn.gap` and `alarm.gap` must be finite numbers.
3. If nothing usable is left (no doc, no field, read error, only TwoD or invalid entries), fall back to **4 / 6 mm on E, N, H**. **TwoD never gets thresholds.**

**Current production registry** (read-only check, 10-05):
- `prism` has `axes` with E/N/H `alertable: true` and TwoD `alertable: false, role: derived`.
- It has **no `defaultThresholds` field yet**. There's only the legacy UI field `defaultThreshold` (singular) = `{"HeightDisplacement":{}}`, which the bridge ignores.
- So until someone adds `defaultThresholds`, new points get the fallback **4/6 mm on E/N/H**. That's the same as before minus TwoD.

**Baseline event** (shared contract in `tasks.md` and functions `setBaseline.ts`):
```jsonc
{ "time": 1790000000000, "reason": "ats-setup",
  "initial": { "EastingDisplacement": 1.5, "NorthingDisplacement": -2, "HeightDisplacement": 0.25, "TwoDDisplacement": 2.5 },
  "by": "bridge", "note": "auto-created for ATS-5-f4p4", "createdAt": 1791232596462 }
```

**Untouched:**
- Existing sensors. The registry read, thresholds and event happen only on the branch that creates a new sensor.
- The routing (map → legacy fallback → create).
- `storeAtsSample`.

The registry is read once per new sensor. That only happens on the first sample of an unmapped device, so no cache was added.

## 2. Dependency: alert suppression for unconfirmed points

With thresholds present, `checkThresholds` evaluates these sensors (`evalAxes` = threshold axes). **Until functions skips alerts for `confirmed === false` sensors** (and the UI provides the confirm action), new auto-created points **will alert as they did on 10-05**, just without TwoD.

Deploying the bridge alone doesn't stop that. The functions-side guard should ship with or before this deploy. A sensible scope for that guard: still compute smoothing/eval, but create no client alert.

## 3. Verification

The repo has no tests, so I wrote a throwaway script in `/tmp` (deleted afterwards). It ran the real `firestoreService.js` against the local **Firestore emulator** on Node 20, the same major as the image (`node:22`), with a fake key and no prod access. **All passed:**

1. **No registry doc** → E/N/H 4/6 mm. Two concurrent first samples → one sensor, one map entry, **one** baseline event with the right `time`, `reason`, `initial` (= `initial-value`), `by`, `note` and numeric `createdAt`. `confirmed: false`. A later sample routes via the map and adds no new event.
2. **Registry with `defaultThresholds`** → used as-is for E and H. The TwoD entry is dropped (not alertable), and an entry with a non-numeric gap is dropped.
3. **Registry with only unusable entries** (TwoD) → fallback 4/6 on E/N/H.
4. **Registry without an `axes` map** → TwoD still excluded.
5. **Existing mapped sensor** → thresholds untouched, no baseline event.

`node --check` is clean.

## 4. Not addressed (flagging)

- **The 48 sensors from 10-05** keep their current 4/6 mm thresholds, TwoD included, and no baseline event. Per instructions, existing sensors aren't touched. A oneoff could drop their TwoD thresholds and add the `ats-setup` event if wanted.
- **`cleanUnconfirmedSensors`** (functions, daily) deletes `confirmed: false` sensors older than 7 days. It deletes the sensor doc only, not the map entry or data-log (findings-2026-09-23 §4). The 10-05 sensors hit this around **10-12** unless confirmed first. After that the bridge writes into deleted docs. Worth guarding in functions together with §2.
- `location.site` is still the raw `siteId` (`"DeVinci-1"`), not a project ID. That's BR-1.1 ("unassigned" list).
- To populate the registry: add `defaultThresholds` to `devices-types/sensors/devices/prism`, for example `{ EastingDisplacement: {warn:{gap:4},alarm:{gap:6}}, NorthingDisplacement: {…}, HeightDisplacement: {…} }`. The bridge picks it up for the next new sensor, with no deploy needed.
- Later (not done): BR-1.1 (no auto-create, unassigned list) and ATS-1.3 (station re-teach event → baseline event), `tasks.md` §4/§4b.

## 5. Deploy (after approval)

Commit `4450a5b` is on `origin/master`. On `monitoring-bridge-vm`:
1. `cd ~/monitoring-bridge && ./deploy.sh`. It runs `git pull origin master`, rebuilds and restarts the container.
2. `bridge-log`: check the bridge reconnects and there are no `[FIRESTORE]` errors.
3. On the next auto-created sensor, look for `Created new ATS sensor and map for device …`. The doc should have E/N/H thresholds (no TwoD) and `confirmed: false`, and `baseline-events` should have one `ats-setup` doc.

Rollback: `git revert 4450a5b`, push, then `./deploy.sh`.
