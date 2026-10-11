# Feedback: `scanin-svc-mqtt-bridge`: ATS station health + events

**Date:** 2026-10-11
**Task:** [`docs/ats/bridge-ats-health-handoff.md`](../../ats/bridge-ats-health-handoff.md) §1–§4 (bridge part). §5 (functions `onAtsStationEvent`) is **not** done, see §6.
**Repo:** [scanin-svc-mqtt-bridge](https://github.com/ScanInLtd/scanin-svc-mqtt-bridge)
**Status:** implemented and tested end to end locally. Committed **`2f5593f`** and pushed to `master`. **VM deploy waiting for Hillel's approval.**

---

## 1. What changed

| File | Change |
|---|---|
| `src/services/atsStationService.js` (new) | `storeAtsHealth`, `storeAtsEvent`, `mergeAtsStatus`, `resolveAtsPointSensor`. It depends only on the default firebase-admin app, so the backfill script reuses the exact live code. |
| `src/handlers/scaninHandler.js` | In the existing `ats-` branch of `processUplinkMessage`: `ats-health` / `ats-event` go to the new service; `status` is merged (§3.3) **and** still stored raw. Invalid payloads or write errors fall back to `ats_raw_payloads` + a warning log, as today. Anything else still goes to `ats_raw_payloads`. |
| `src/services/firestoreService.js` | `storeAtsSample` copies `cycle_id`, `gateway_id`, `qc_flag`, `matched_point`, `held` into the data-log doc **when present** (omitted when absent/null), next to `suspect` / `suspect_reason`. Nothing else in sample handling changed. |
| `scripts/backfill-ats-station-health.js` (new) | Replays `ats_raw_payloads` rows of type `ats-health` / `ats-event`, oldest first, through the live code. Dry-run by default, `--execute` to write. Idempotent. |

I checked the payloads against the station code on `quality-gates` (`engine/cycle.py::_health_message`, `engine/rebaseline.py::enqueue_event`, `api/monitoring.py` reference-refound, `sync/publisher.py::build_sample_payload`). Topics and fields match the handoff.

## 2. Firestore (as specified, with the details I had to decide)

| Path | Behaviour |
|---|---|
| `ats-station-health/{deviceId}` | Overwritten (no merge) with the payload + `lastSeenAt` (server time) + `lastCycleId` + `lastHealthStatus`, **in a transaction**. Skipped if the stored doc is the same `siteId` and its `cycle.finishedAt` is newer (the fallback is `timestamp` when `finishedAt` is missing). Equal → overwrite, so a re-send of the latest is a no-op in effect. A different `siteId` always overwrites. |
| `…/cycles/{siteId}_{cycleId}` | Payload + `receivedAt`, always written, so late cycles land in history. |
| `…/events/{siteId}_{type}_{timestamp}` | Payload + `receivedAt` + `status: "received"`. Created **only if absent** (transaction). A re-send never overwrites an event, so an `applied` event can't be reset to pending and re-applied. |
| §3.3 `lastStatus` / `lastStatusAt` | Merged into the latest doc on each gateway `uplink/status`. The no-merge overwrite on the next `ats-health` **keeps** these two fields (read in the same transaction), otherwise every cycle would erase them. |

- **Validation** (otherwise raw + warning): `schemaVersion === 1`, `deviceId` equals the topic gateway id, `siteId` and `cycle.id` present (health) / `type` and `timestamp` present (event). Unknown check names, unknown event types and free-form `details` are stored as-is.
- `/` in `siteId` would break doc ids, so it's replaced with `_` in ids only. The stored payload is unchanged.
- **Rebaseline resolution:** `ats-device-map/{deviceId}-{pointId}`, then the legacy `atsDeviceId` query. **Nothing is created.** One deviation from "the same way samples are routed": if the map points at a **deleted** sensor doc (this happens: findings-2026-09-23 §4, `cleanUnconfirmedSensors`), the point gets `error: "sensor doc missing (<id>)"` instead of a `sensorId` the function would write a baseline into. Otherwise `error: "no sensor"`. Then `status: "pending-baseline"` is set only if the doc is still `received` (transaction). A doc left at `received` by a crash is resolved again on the next re-send.
- `reference-refound` and unknown types: stored with `status: "received"`, nothing else.
- The gateway id never reaches `findOrCreateAtsSensor`, so no `work-sensors` / `ats-device-map` doc is created for it (tested).

## 3. Firestore rules: no change needed

The deployed rules lineage is `scanin-web-platform/firestore.rules` (the functions repo copy is a different, older Rowy-era file; see functions-phase1 §5). It has **no** rule for `ats-runs` / `ats_raw_payloads`. They're covered by the catch-all `match /{document=**} { allow read, write: if request.auth != null; }`. So `ats-station-health/**` is already readable by any signed-in user, exactly like `ats-runs`. An explicit read rule wouldn't change anything while the catch-all exists (rules are OR-ed). The catch-all also lets signed-in clients **write** here, same as `ats-runs` today. Tightening that is part of the general rules cleanup, not this task.

## 4. Verification

The repo has no tests, so I wrote throwaway scripts in `/tmp` (deleted). They ran the **real bridge** (`mqttService` + all handlers + Firestore code) against a local MQTT broker (`aedes@0.51.3`, `/tmp` only) and the **Firestore emulator**, with no prod access. **All passed:**

1. `ats-health` cycle 276 → latest doc (`lastCycleId` 276, `lastHealthStatus`, `lastSeenAt`, unknown check stored as-is, `frame: null` kept) + one history doc. **Same message again** → still one history doc.
2. Cycle 277, then a **late cycle 275** → history has all three; the latest stays 277.
3. Gateway `uplink/status` → `lastStatus` merged and still stored raw. The next `ats-health` (278) overwrites the latest **and keeps `lastStatus`**.
4. `ats-health` with `deviceId` ≠ topic → no history doc, payload in `ats_raw_payloads`, warning logged.
5. `rebaseline` for 4 points → `pending-baseline` with `f4p4→s-f4p4` (map), `A2X→s-legacy` (legacy fallback), `G11→sensor doc missing`, `X9→no sensor`. After setting `status: "applied"` (as the function will), a **re-send leaves it `applied`**.
6. `reference-refound` and an unknown type → stored, `received`.
7. A sample with the 5 new fields → all 5 in the data-log doc. A sample without them → none of the keys present.
8. No `work-sensors` / `ats-device-map` doc for `ATS-5` after all of the above.
9. Backfill script (emulator): dry-run lists and validates; `--execute` stores the rows in `receivedAt` order (cycle 10 then 11 → latest 11) and skips invalid rows; a re-run changes nothing.

**Production today** (read-only): `ats_raw_payloads` has **0** `ats-health`, **0** `ats-event` and **0** `status` rows, and `ats-station-health` is empty. The new station release isn't deployed, so there's **nothing to backfill yet**. Run the script only if station messages arrive before this bridge deploy.

## 5. Deploy (after approval)

`2f5593f` is on `origin/master`. On `monitoring-bridge-vm`: `cd ~/monitoring-bridge && ./deploy.sh`, then `bridge-log | grep -E "ATS-HEALTH|ATS-EVENT|Invalid ats"`. Nothing changes until the station release publishes; samples from today's station are unchanged (no new fields → nothing copied).

Order per handoff §6: bridge (this) → functions §5 → station release.
Rollback: `git revert 2f5593f`, push, `./deploy.sh`. The raw-payload fallback then catches the new messages again.

## 6. Open / for the functions owner

- **§5 `onAtsStationEvent` is not implemented.** Until it is, `rebaseline` events stay at `pending-baseline` (stored, nothing applied). Contract as delivered: `points[i].sensorId` **or** `points[i].error`, and the event's `status` is exactly `"pending-baseline"` when it's ready. The function should skip points with `error` and report them in `"partial"`. I can implement it in `scanin-svc-firebase-functions` if you want, reusing `applyBaseline` with zero initials as in the handoff.
- Want the bridge to raise an internal notice (`data-integrity`) for rebaseline points that resolve to `no sensor` / `sensor doc missing`? Today it's only in the event doc and the bridge log.
- Watchdog on `lastHealthStatus` / `lastSeenAt` and the UI page are out of scope (§7). `lastSeenAt` is **not** touched by a late (older) re-send. Liveness without cycles comes from `lastStatusAt`.
