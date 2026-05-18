# MQTT Bridge — Heartbeat Implementation Task

## Context

ScanIn is an IoT monitoring platform for construction/infrastructure sites. Sensors send data through MQTT → Bridge → Firestore. A web platform displays data. Automated functions check thresholds and send alerts (WhatsApp, email). Scheduled jobs generate daily reports and process displacement calculations.

All services self-report heartbeats to a shared Firestore collection. A Cloud Run watchdog reads these heartbeats + GCP APIs, evaluates health, and sends alerts.

```
Services → system-heartbeats/{serviceName}  (Firestore, overwritten)
                     ↓
Cloud Scheduler → Watchdog (Cloud Run)
                     ↓
           Alerts (WhatsApp) + Incidents (Firestore)
```

Full design docs:
- [System Monitoring Design](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/system-monitoring-design.md)
- [Per-Component Check Specs](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/monitoring-checks.md)
- [Progress Tracker](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/monitoring-progress.md)

Local path (if cloned): `../scanin-handbook/docs/monitoring/`

---

## What This Repo Is

`scanin-svc-mqtt-bridge` is a Dockerized Node.js app running on `monitoring-bridge-vm` (GCP Compute Engine). It subscribes to MQTT topics on the Mosquitto broker (34.38.96.215:8883 TLS), receives sensor data, and writes it to Firestore (`work-sensors/{id}/data-log/{entry}`).

It runs via Docker Compose on the VM. No HTTP endpoint — pure MQTT consumer.

---

## What To Add

### 1. Subscribe to `$SYS/#` topics

Mosquitto publishes broker stats on `$SYS/#` topics. Subscribe to these alongside existing sensor topics:

- `$SYS/broker/clients/connected` — number of connected clients
- `$SYS/broker/messages/received` — total messages received (cumulative counter)
- `$SYS/broker/uptime` — broker uptime in seconds

Store latest values in memory (simple object). These get included in the heartbeat.

### 2. Track rolling metrics in memory

Maintain in-memory counters (reset on restart, that's fine):

```ts
// Rolling window counters
let messagesReceivedLast5m = 0;   // reset every 5 min
let messagesWrittenLast5m = 0;    // reset every 5 min
let writeFailuresLast1h = 0;      // reset every 1h
let uniqueSensorsLast1h = new Set<string>();  // reset every 1h
let writeLatencies: number[] = [];  // last N, compute avg
let mqttReconnectsLast1h = 0;     // reset every 1h
let lastMessageAt: Date | null = null;
let lastFirestoreWriteAt: Date | null = null;
```

Increment these in existing message handling and Firestore write code paths.

### 3. Heartbeat writer (every 5 min)

Every 5 minutes, write a single Firestore doc:

**Doc path:** `system-heartbeats/mqtt-bridge`

```ts
{
  schemaVersion: 1,
  serviceName: "mqtt-bridge",
  lastSeenAt: FieldValue.serverTimestamp(),
  version: "<from package.json>",
  host: "monitoring-bridge-vm",
  status: "healthy",  // or "warning" if writeFailures > 0, "error" if not connected

  // Bridge metrics
  connectedToMqtt: <boolean>,
  messagesReceivedLast5m: <number>,
  messagesWrittenLast5m: <number>,
  writeFailuresLast1h: <number>,
  uniqueSensorsLast1h: <number>,
  avgWriteLatencyMs: <number>,
  mqttReconnectsLast1h: <number>,
  lastMessageAt: <Timestamp | null>,
  lastFirestoreWriteAt: <Timestamp | null>,

  // Broker metrics (from $SYS)
  brokerClientsConnected: <number | null>,
  brokerMessagesReceivedTotal: <number | null>,
  brokerUptime: <number | null>
}
```

### Status logic

```ts
function computeStatus(): "healthy" | "warning" | "error" {
  if (!connectedToMqtt) return "error";
  if (writeFailuresLast1h > 0) return "warning";
  return "healthy";
}
```

---

## Critical Rules

1. **Use `FieldValue.serverTimestamp()`** for `lastSeenAt` — never `new Date()`
2. **Heartbeat write must be try/catch** — if Firestore is down, the bridge must keep processing messages
3. **Reset 5-min counters** after each heartbeat write
4. **Reset 1-hour counters** on a separate hourly interval
5. **Overwrite, don't accumulate** — always `.set()` the same doc, never `.add()`

---

## Where To Add Code

Look at the existing codebase for:
- MQTT connection setup → add `$SYS/#` subscription there
- MQTT message handler → add $SYS topic parsing + counter increments
- Firestore write calls → wrap with latency tracking
- App startup → add `setInterval` for heartbeat (5 min) and counter resets (1h)

Estimated: ~30-50 lines of new code, no new dependencies (Firestore SDK already used).

---

## Testing

After deployment, verify:
1. `system-heartbeats/mqtt-bridge` doc appears in Firestore console
2. `lastSeenAt` updates every ~5 minutes
3. `brokerClientsConnected` has a value > 0
4. `messagesReceivedLast5m` reflects actual traffic
5. Kill bridge → doc stops updating (watchdog will detect staleness)
6. Restart bridge → doc resumes updating, `mqttReconnectsLast1h` increments
