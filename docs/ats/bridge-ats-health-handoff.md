# Bridge task: ATS station health + events (new uplink messages, new collection)

_From: ATS station software (`scanin-fw-ats-monitoring`, branch `quality-gates`, not deployed yet) · 2026-10-11 · For: bridge team (`scanin-svc-mqtt-bridge`), with one small function in `scanin-svc-firebase-functions` (§5)._
_Background: [`devinci-diagnosis-2026-10-11.md`](./devinci-diagnosis-2026-10-11.md), plan [`ats-station-health-plan.md`](./ats-station-health-plan.md)._

## 0. Why

At DeVinci station 5 the ATS published wrong values as real movement for days (points measuring another prism: metres; points whose baseline was taken in a bad cycle: ~100 mm and ~20 mm), because "a value that repeats" was treated as confirmed. The next station release checks its own health every cycle, stops publishing those values, and tells the cloud what it found and why. The cloud needs to store that, and to apply re-baselines the station decides on.

**Nothing breaks before you deploy:** today every non-`samples` message from an `ATS-…` device goes to `ats_raw_payloads` (as `uplink/status` already does), so the new messages are kept there until the bridge handles them. You can backfill from there.

## 1. What changes on the wire

| Topic | Who | When | Today in the bridge | Wanted |
|---|---|---|---|---|
| `scanin/{gatewayId}/uplink/ats-health` | **new** | once per monitoring cycle (~every 4 h per station; also failed / cancelled cycles) | → `ats_raw_payloads` | store (§3) |
| `scanin/{gatewayId}/uplink/ats-event` | **new** | rare (operator actions) | → `ats_raw_payloads` | store + act (§4) |
| `scanin/{gatewayId}-{pointId}/uplink/samples` | existing | per point per cycle | → `work-sensors/{id}/data-log` | copy 5 new optional fields (§2) |
| `scanin/{gatewayId}/uplink/status` | existing heartbeat | **required** (station: `heartbeat_interval_s` > 0) | → `ats_raw_payloads` | keep raw + merge into the latest doc (§3.3) |

- `gatewayId` = the station's `MQTT_DEVICE_ID`. DeVinci station 5: **`ATS-5`** (its samples are `ATS-5-A4`, `ATS-5-f8p13`, …). It starts with `ATS-`, so in `scaninHandler.processUplinkMessage` it already enters the `deviceId.toLowerCase().startsWith("ats-")` branch; route `messageType === "ats-health"` / `"ats-event"` there before the raw-payload fallback.
- **Never create a sensor or an `ats-device-map` entry for the gateway id.**
- The names say `ats-` because the bridge serves many sensor types.
- QoS 1, not retained (the bridge already ignores retained messages). The station's outbox re-publishes after outages, so **every write must be idempotent** (deterministic doc ids below).
- `timestamp` fields are Unix **seconds**; Firestore `time` fields elsewhere are ms → multiply by 1000.

## 2. Samples: five new optional fields

`sensorData` may now contain, next to `suspect` / `suspect_reason`:

| Field | Type | Meaning |
|---|---|---|
| `cycle_id` | int | station cycle id — **on every sample from this release** |
| `gateway_id` | string | e.g. `ATS-5` |
| `qc_flag` | string | `wrong-target` · `re-measured` · `stuck-offset` · `too-large` |
| `matched_point` | string | for `wrong-target`: the point whose prism was measured |
| `held` | bool | the whole cycle was held by a quality gate (present only when true) |

**Bridge:** in `storeAtsSample` copy them into the data-log doc as-is (omit when absent), next to `suspect` / `suspect_reason`. Nothing else changes in sample handling.

**Cross-reference sample → cycle:** `ats-station-health/{gateway_id}/cycles/{siteId}_{cycle_id}` (`siteId` is in every sample payload). Cycle ids are unique per station only — always pair them with `gateway_id`. Samples before this release have no `cycle_id`.

By default the station does **not** publish held / suspect / wrong-target / stuck-offset / too-large samples at all. A per-site station setting can later publish them with `suspect: true` for the audit trail (`checkThresholds` already skips `suspect === true`); we'll only enable it once the UI hides or marks suspect samples.

## 3. `ats-health` → new collection `ats-station-health`

### 3.1 Payload (`schemaVersion: 1`)

```json
{
  "schemaVersion": 1,
  "timestamp": 1791718000,
  "deviceId": "ATS-5",
  "siteId": "DeVinci-1",
  "cycle": { "id": 276, "startedAt": 1791717899, "finishedAt": 1791719500,
             "status": "ok|held|failed|cancelled", "quality": "ok|warning|bad",
             "held": false, "published": 35,
             "flags": [{ "flag": "few-references", "level": "bad", "message": "..." }] },
  "resection": { "rmsMm": 5.18, "rmsBeforeExclusionMm": 5.18,
                 "refsUsed": ["R1","R2","R3","R4","R5"],
                 "refsFailed": [{ "id": "R5", "reason": "..." }],
                 "refsExcluded": [{ "id": "R4", "reason": "...", "residualMm": 46.0 }],
                 "residualsMm": { "R1": 6.18, "R2": 7.08 }, "noRedundancy": false },
  "frame": { "prevCycle": 275, "rotMgon": 1.2, "shiftMm": 0.4, "rawRefMoveMm": 0.3,
             "instrumentRotationMgon": -28.5, "verdict": "stable|solve-moved|instrument-moved" },
  "orientation": { "slopeMmPerM": 0.03, "r2": 0.2, "impliedRotMgon": 2, "detected": false, "notFitting": [] },
  "counts": { "ok": 34, "warning": 1, "suspect": 2, "wrongTarget": 6, "held": 0, "failed": 4,
              "stuckOffset": 17, "tooLarge": 0 },
  "points": [{ "id": "D8", "status": "wrong-target", "dispMm": 7686.8, "matchedPoint": "G11", "reason": "..." }],
  "health": { "status": "ok|warning|bad",
              "checks": [{ "check": "instrument-rotation", "status": "warning",
                           "message": "instrument turned -28.5 mgon on its base since cycle 275 ...",
                           "suggestion": "check the mount / bracket screws ...", "details": {} }] },
  "instrument": { "tiltStart": { "crossMgon": 5.0, "lengthMgon": 2.1 },
                  "tiltEnd": { "crossMgon": 4.6, "lengthMgon": 2.0 },
                  "refDriftMgon": 0.3, "linkEvents": 0 }
}
```

- Size: ~5–15 KB (≈60 points). `frame`, `orientation`, `instrument.tiltEnd` / `refDriftMgon` may be `null` (failed cycle, first cycle).
- `points[].status`: `passed · warning · suspect · wrong-target · stuck-offset · too-large · held · failed`.
- `health.checks[].check`: `instrument-rotation`, `instrument-stability`, `reference-consistency`, `prism-constant`, `geometry`, `swapped-prisms`, `stuck-offset`, `duplicate-points`, `frame-offset`, `link`. **Store unknown values as-is** — more checks will be added without a schema bump. `details` is free-form.
- Validate only: `schemaVersion === 1`, `deviceId` equals the topic's gateway id, `siteId` and `cycle.id` present. Otherwise → `ats_raw_payloads` + warning log (keep today's behaviour).

### 3.2 Firestore writes

| Path | Write |
|---|---|
| `ats-station-health/{deviceId}` | **latest state**, `set(..., {merge: false})` overwrite: the whole payload + `lastSeenAt: serverTimestamp()` + `lastCycleId: cycle.id` + `lastHealthStatus: health.status` + `stationSilent: false`. `lastStatus` / `lastStatusAt` (§3.3) are carried over through the overwrite |
| `ats-station-health/{deviceId}/cycles/{siteId}_{cycleId}` | **history**: the whole payload + `receivedAt: serverTimestamp()`. Deterministic id → a re-send overwrites the same doc |

- **Only overwrite the latest doc if the message is not older** than what's stored (`cycle.finishedAt` ≥ stored `cycle.finishedAt`, same site) — re-sends after an outage arrive late and out of order.
- No new indexes needed for these writes. For the later UI: history ordered by `cycle.finishedAt` (single-field, automatic).
- `firestore.rules`: add read access to `ats-station-health/**` for the same roles that read `ats-runs` (writes only by the bridge service account) — check which repo deploys the rules (web-platform vs functions).

### 3.3 Liveness (required)

`uplink/status` heartbeats of the gateway: also merge `{lastStatus: payload, lastStatusAt: serverTimestamp(), stationSilent}` into `ats-station-health/{deviceId}`, so a station that stopped cycling but is alive is visible from one doc read.

- `stationSilent` = no `ats-health` received for `ATS_STATION_SILENT_AFTER_HOURS` (bridge env, default **8 h** ≈ two 4-h cycles), measured from `lastSeenAt`; `true` if the station never delivered a cycle. Re-evaluated on every heartbeat; every newer `ats-health` resets it to `false`.
- A heartbeat older than the stored `lastStatus.timestamp` (outbox re-send) is ignored.
- The bridge can only update these fields when a message arrives. For a check: `stationSilent == true` with a fresh `lastStatusAt` means alive but not cycling; a stale `lastStatusAt` and `lastSeenAt` means the station or its link is down.
- **Station:** heartbeats are off by default (`schedules.heartbeat_interval_s = 0`). Enable them (e.g. 15–30 min) with this release, or `stationSilent` / `lastStatusAt` never update.

## 4. `ats-event` → store, resolve sensors, trigger the baseline

### 4.1 Payloads

```json
{ "schemaVersion": 1, "timestamp": 1791720000, "deviceId": "ATS-5", "siteId": "DeVinci-1",
  "type": "rebaseline",
  "reason": "re-baselined: offset was a baseline problem, not movement",
  "points": [{ "id": "f4p4", "at": 1791720000, "deltaMm": 107.9,
               "old": { "e": 17.1, "n": 60.2, "u": -3.4 }, "new": { "e": 17.2, "n": 60.1, "u": -3.4 },
               "sourceCycles": [277, 276] }] }
```

```json
{ "schemaVersion": 1, "timestamp": 1791720000, "deviceId": "ATS-5", "siteId": "DeVinci-1",
  "type": "reference-refound", "pointId": "R4", "deltaMm": 58.5, "rmsUsedMm": 4.38,
  "refsUsed": ["R1","R2","R3","R5"], "reason": "...",
  "old": { "e": 17.605, "n": 58.4949, "u": 1.784 }, "new": { "e": 17.5838, "n": 58.4404, "u": 1.783 } }
```

Unknown `type` → store it (§4.2) and do nothing else.

### 4.2 Bridge

1. Store every event: `ats-station-health/{deviceId}/events/{siteId}_{type}_{timestamp}` = payload + `receivedAt` + `status: "received"`.
2. For `rebaseline`: resolve each point to its sensor the same way samples are routed — `ats-device-map/{deviceId}-{pointId}` (with the existing fallback) — and write it back into the event doc: `points[i].sensorId` (or `points[i].error: "no sensor"`). Then set `status: "pending-baseline"`.
3. That's all for the bridge. **Don't write `baseline-events` / `initial-value` directly**: the existing `applyBaseline` (functions, `setBaseline.ts`) also resets `status.axes` and `alert_state.axes`, resolves integrity notices and recomputes smoothing — duplicating half of that in the bridge would leave sensors inconsistent.
4. `reference-refound`: store only (it shifts the frame slightly; it will feed a frame-change baseline later, task §8).

## 5. Functions (small, whoever owns `scanin-svc-firebase-functions`)

New trigger `onAtsStationEvent`: `onCreate` / `onWrite` on `ats-station-health/{deviceId}/events/{eventId}` where `type == "rebaseline"` and `status == "pending-baseline"`. For each point with a `sensorId`:

```ts
await applyBaseline({
  sensorId,
  time: point.at * 1000,
  reason: "rebaseline",
  note: `ATS ${deviceId} re-baseline (${event.reason}); Δ ${point.deltaMm} mm; cycles ${point.sourceCycles.join(",")}`,
  // The station's displacements restart at ~0 from `at`, so the new baseline is zero on every axis
  // (same keys the bridge seeds for auto-created ATS sensors).
  initial: { EastingDisplacement: 0, NorthingDisplacement: 0, HeightDisplacement: 0, TwoDDisplacement: 0 },
}, `ats:${deviceId}`);
```

Then set the event's `status: "applied"` (or `"partial"` with per-point errors). Idempotency: skip if `status` is already `applied`. `BASELINE_REASONS` already contains `"rebaseline"`.

## 6. Order and acceptance

1. Bridge §2 + §3 + §4 (deploy whenever ready — the station keeps working either way; backfill `ats_raw_payloads` rows of type `ats-health` / `ats-event` once deployed).
2. Functions §5.
3. Station release on DeVinci (after Hillel's approval).

Acceptance:
- Publish the example payloads → docs at the paths above; the same message twice → still one history doc / one event doc; an older `ats-health` after a newer one doesn't overwrite the latest doc.
- A sample with the new fields → the five fields appear in the data-log doc.
- A `rebaseline` event for 2 points → event doc with `sensorId`s → function applies `rebaseline` baselines at `at` with zero initials → `status: "applied"`; the sensors' charts restart at 0 and no alert fires.
- An `ats-health` message from a gateway id never creates a `work-sensors` doc.

## 7. Not in this task

- Watchdog alerting on `ats-station-health/{deviceId}.lastHealthStatus` / `lastSeenAt`.
- Web-platform station-health page.
- **Cleaning the cloud history at DeVinci since 08.10** (samples published with metres / ~100 mm / ~20 mm offsets on A2, B1, D8, G11, F11, I11, f8p1 and 21 f-points): a separate ops one-off (`ops/src/oneoff/…`, dry-run first) to mark them `suspect: true` — list in the diagnosis §3.6.
