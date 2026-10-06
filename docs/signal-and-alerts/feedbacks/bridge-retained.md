# Feedback: `scanin-svc-mqtt-bridge`: ignore retained MQTT messages

**Date:** 2026-10-06
**Repo:** [scanin-svc-mqtt-bridge](https://github.com/ScanInLtd/scanin-svc-mqtt-bridge)
**Status:** implemented and tested locally (broker + bridge), committed **`9fbaa76`** and pushed to `master`. VM redeploy by Hillel (§5).
**Trigger:** retained messages were re-ingested as new samples on every bridge (re)connect. Example: ים המלח תנור "RUpperBeamOut [5.1]" (ICL gateway `64B47B33E864`) has the same sample (2025-02-24T13:00:27Z, x = 6007) as **85** data-log docs, one per bridge restart over 19 months. Retained topics on the broker (2026-10-06): `ICL_Datalogger/sensor_data`, `ScaninVibration`, `ScaninVibrationNotif`, `beanair/vibration/notif/<mac>` (~28), `scanin/A0:85:E3:F3:65:CC|C0/uplink/samples`.

---

## 1. What changed

Dispatch actually lives in **`src/services/mqttService.js`** (`client.on("message")` → `dispatchToHandler`), not `main.js`. `main.js` only calls `initializeMqtt()`. So the filter sits there, in one place before any handler:

| File | Change |
|---|---|
| `src/services/mqttService.js` | The `message` listener takes the `packet` argument. **After** the `$SYS/` branch and **before** `onMessageReceived()` / `dispatchToHandler()`: if `packet.retain` is true, it calls `onRetainedIgnored()`, logs `[RETAINED] ignored <topic>` (warn, **once per topic per process**, via an in-memory `Set`), and returns. |
| `src/services/heartbeatService.js` | New `onRetainedIgnored()` counter. Each 5-min heartbeat cycle adds it to **`system-metrics/mqtt-bridge/daily/{date}.retainedIgnored`** (`FieldValue.increment`, same merge write as `messagesReceived`/`cycles`), then resets it. Retained messages no longer count in `messagesReceived`. |

**Unchanged:**
- Handlers, doc IDs, storage, routing.
- The `$SYS/*` path. Mosquitto publishes `$SYS` as retained, and the heartbeat's broker metrics need it, so it stays before the filter.
- Existing duplicates are not touched or deleted.

## 2. Scope: does any subscribed topic rely on retained? No

The bridge subscribes **only** to handler topics (+ `$SYS`):

| Handler | Topics |
|---|---|
| Scanin | `scanin/+/uplink/#` |
| Integration | `scanin/integration/+/+/uplink/#` |
| Beanair Tilt | `+/SENSOR/3`, `+/SENSOR/4`, `beanair/tilt/+/x`, `beanair/tilt/+/y` |
| Beanair Vibration | `ScaninVibration`, `beanair/vibration/+`, `beanair/vibration/notif/+` |
| ICL | `ICL_Datalogger/sensor_data` |
| Photon | `PhotonMsg`, `photon-get-status` |
| Targets | `HubMsg`, `Hub_connected`, `HubResetReq` |

- Downlink, settings, firmware and `hub-req-*` topics are **published** by the bridge (`sendUpdate`, `{ qos: 1 }`, no retain) and never subscribed, so the filter can't affect them. Devices that rely on retained downlinks (if any) get them from the broker, unchanged.
- Publisher specs: Targets says `Retain: false` on all topics (`TARGETS_MQTT_BRIDGE_SPEC.md`). The ATS handoff says `Retain: false`. ESP firmware/protocol docs don't mention retain.
- **Source of the retained messages:** `scanin-svc-beanair-vibration-processor/MqttSSL/MqttSSL.cs` `PublishAsync(..., bool retainFlag = true, ...)`. Retain is the **default**, which is consistent with the Beanair processor fix already in progress. Where the retained `ICL_Datalogger` and `scanin/A0:85:E3:F3:65:CC*` messages came from isn't visible in the repos (ICL gateway firmware / a test publish?).

So the filter applies to **all** handler topics with no exceptions.

**Why live data is unaffected:** per MQTT 3.1.1 §3.3.1.3, a broker sends `retain = 1` only for the stored message delivered on (re)subscribe. Messages forwarded to an already connected subscriber have `retain = 0`, **even if the publisher set retain**. The test checks this case explicitly (§3).

## 3. Verification

The repo has no tests, so I wrote a throwaway script (`/tmp`, deleted). It ran the **real** `mqttService.js` / `heartbeatService.js` / `logger.js` against a local in-process broker (`aedes@0.51.3`, installed only in `/tmp`). Handlers were stubbed, and the Firestore endpoint pointed at a dead port, so there was no prod access. **All passed:**

1. Three retained messages on the broker before the bridge connects (ICL, `beanair/vibration/notif/AA`, `scanin/A0:85:E3:F3:65:CC/uplink/samples`) → **0 dispatched**, counter +3.
2. Live messages (ICL, beanair) **and one published with `retain: true` while the bridge was connected** → all 3 dispatched.
3. Broker-side disconnect → the bridge reconnected and re-subscribed, and the broker replayed the retained messages → **0 dispatched**, counter +3 more.
4. `[RETAINED] ignored <topic>` logged **exactly once per topic** across both connections.

`node --check` is clean. The `retainedIgnored` daily increment wasn't exercised against Firestore. It's one more field in the existing merge write, read from the same snapshot pattern as `messagesReceived`.

## 4. Notes / follow-ups (not done)

- **Existing duplicates stay** (e.g. the 85 copies). Dedup needs a separate oneoff (dry-run → `--apply`). Key: same sensor + same `time` + same values, keep the oldest `createTime`. Smoothing/alerts are already safe from re-writes (functions Phase 0: `onCreate` + skip samples > 48h old), but charts/reports/exports show the copies.
- After deploy, the first restart logs one `[RETAINED] ignored …` line per still-retained topic. That's a direct list of what's left to clear on the broker. Once the broker is cleaned, `retainedIgnored` should stay ≈ 0. A non-zero daily value means a publisher is retaining again (worth a watchdog check later).
- Side effect: `messagesReceived` in daily metrics drops slightly on restart days, because replayed retained messages no longer count.

## 5. Deploy (after approval)

1. Done: `9fbaa76` is on `origin/master` (`deploy.sh` runs `git pull origin master`).
2. On `monitoring-bridge-vm`: `cd ~/monitoring-bridge && ./deploy.sh`, then `bridge-log | grep -E "RETAINED|Connected to broker"`.
3. Expect one `[RETAINED] ignored <topic>` per still-retained topic right after connect, and **no** new data-log doc for those payloads. The next day, `system-metrics/mqtt-bridge/daily/{date}` has `retainedIgnored`.

Rollback: `git revert 9fbaa76`, push, `./deploy.sh`.
