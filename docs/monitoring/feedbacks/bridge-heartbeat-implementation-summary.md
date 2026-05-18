# Heartbeat Implementation Summary

**Service:** `scanin-svc-mqtt-bridge`  
**Date:** 2026-05-18  
**Status:** Implemented, ready for deployment  

---

## What Was Done

Implemented self-reporting heartbeat for the MQTT bridge service, writing to `system-heartbeats/mqtt-bridge` every 5 minutes.

### Files Changed

| File | Change |
|------|--------|
| `src/services/heartbeatService.js` | **New** — Core heartbeat logic: metrics, $SYS handling, status computation, heartbeat writer |
| `src/services/mqttService.js` | Subscribe to `$SYS/#`, route $SYS messages, track connection state and reconnects |
| `src/services/firestoreService.js` | Track write latency and failures in `storeData()` |
| `src/main.js` | Initialize heartbeat on startup |

### Architecture

```
MQTT Broker ($SYS topics)  →  heartbeatService (in-memory metrics)
Message handlers           →  onMessageReceived()
Firestore writes           →  onFirestoreWrite(latencyMs, sensorId)
Firestore errors           →  onFirestoreWriteFailure()
MQTT reconnects            →  onMqttReconnect()
                               ↓
                setInterval (every 5 min)
                               ↓
          Firestore: system-heartbeats/mqtt-bridge (.set())
```

### Heartbeat Document Schema

```json
{
  "schemaVersion": 1,
  "serviceName": "mqtt-bridge",
  "lastSeenAt": "<serverTimestamp>",
  "version": "1.0.0",
  "host": "monitoring-bridge-vm",
  "status": "healthy | warning | error",

  "connectedToMqtt": true,
  "messagesReceivedLast5m": 142,
  "messagesWrittenLast5m": 138,
  "writeFailuresLast1h": 0,
  "uniqueSensorsLast1h": 47,
  "avgWriteLatencyMs": 34,
  "mqttReconnectsLast1h": 0,
  "lastMessageAt": "<timestamp>",
  "lastFirestoreWriteAt": "<timestamp>",

  "brokerClientsConnected": 12,
  "brokerMessagesReceivedTotal": 584321,
  "brokerUptime": 8640000
}
```

### Status Logic

| Condition | Status |
|-----------|--------|
| MQTT disconnected | `error` |
| Write failures > 0 in last hour | `warning` |
| Otherwise | `healthy` |

### Counter Reset Schedule

| Counter | Reset |
|---------|-------|
| `messagesReceivedLast5m`, `messagesWrittenLast5m` | After each heartbeat write (every 5 min) |
| `writeFailuresLast1h`, `uniqueSensorsLast1h`, `mqttReconnectsLast1h` | Every 1 hour |

---

## Critical Rules Followed

1. ✅ `FieldValue.serverTimestamp()` used for `lastSeenAt`
2. ✅ Heartbeat write wrapped in try/catch — failures don't disrupt message processing
3. ✅ 5-min counters reset after each heartbeat write
4. ✅ 1-hour counters reset on separate hourly interval
5. ✅ Always `.set()` (overwrite), never `.add()`

---

## Deployment

```bash
# On monitoring-bridge-vm:
cd /home/scanin.link/monitoring-bridge
./deploy.sh
# Select option 1 (Full deployment)
```

## Verification

After deployment, confirm:

1. `system-heartbeats/mqtt-bridge` doc appears in Firestore console
2. `lastSeenAt` updates every ~5 minutes
3. `brokerClientsConnected` has a value > 0
4. `messagesReceivedLast5m` reflects actual traffic
5. Kill bridge → doc stops updating (watchdog will detect staleness)
6. Restart bridge → doc resumes updating, `mqttReconnectsLast1h` increments

---

## Dependencies

No new dependencies added. Uses existing `firebase-admin` SDK.
