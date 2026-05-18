# Daily Metrics — All Services

## Overview

Each service writes a daily aggregation doc using atomic increments. This gives 30-day history for dashboards/trends. The watchdog's `rotation.ts` already deletes docs > 30 days.

**Pattern:** `system-metrics/{serviceName}/daily/{YYYY-MM-DD}`  
**Operation:** `.set({ ... }, { merge: true })` with `FieldValue.increment()`  
**When:** After each cycle, alongside the heartbeat write

---

## 1. MQTT Bridge (Node.js)

**Doc:** `system-metrics/mqtt-bridge/daily/{date}`

```js
const today = new Date().toISOString().slice(0, 10); // "2026-05-19"

await db.collection('system-metrics').doc('mqtt-bridge')
  .collection('daily').doc(today)
  .set({
    messagesReceived: admin.firestore.FieldValue.increment(messagesThisCycle),
    errors: admin.firestore.FieldValue.increment(errorsThisCycle),
    cycles: admin.firestore.FieldValue.increment(1)
  }, { merge: true });
```

**Where:** In `heartbeatService.js`, right after the heartbeat write (inside the same try/catch).  
**Frequency:** Every 5 min (~288 writes/day)

---

## 2. ATS Ingestion (C#)

**Doc:** `system-metrics/ats-ingestion/daily/{date}`

```csharp
var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
var metricsRef = db.Collection("system-metrics").Document("ats-ingestion")
    .Collection("daily").Document(today);

await metricsRef.SetAsync(new Dictionary<string, object>
{
    ["emailsFound"] = FieldValue.Increment(emailsFound),
    ["emailsProcessed"] = FieldValue.Increment(emailsProcessed),
    ["emailsFailed"] = FieldValue.Increment(emailsFailed),
    ["sensorsUpdated"] = FieldValue.Increment(sensorsUpdated),
    ["cycles"] = FieldValue.Increment(1)
}, SetOptions.MergeAll);
```

**Where:** In `WriteHeartbeatAsync()`, right after the heartbeat `.SetAsync()`.  
**Frequency:** Every email check cycle (~12/day)

---

## 3. Vibration Processor (C#)

**Doc:** `system-metrics/vibration-processor/daily/{date}`

```csharp
var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
var metricsRef = db.Collection("system-metrics").Document("vibration-processor")
    .Collection("daily").Document(today);

await metricsRef.SetAsync(new Dictionary<string, object>
{
    ["samplesFound"] = FieldValue.Increment(found),
    ["samplesProcessed"] = FieldValue.Increment(processed),
    ["samplesFailed"] = FieldValue.Increment(failed),
    ["dinAlerts"] = FieldValue.Increment(dinAlerts),
    ["cycles"] = FieldValue.Increment(1)
}, SetOptions.MergeAll);
```

**Where:** In `HeartbeatWriter.WriteAsync()`, right after the heartbeat `.SetAsync()`.  
**Frequency:** Every 2 min (~720/day)

---

## 4. Reports Orchestrator (Node.js)

**Doc:** `system-metrics/reports-orchestrator/daily/{date}`

```js
const today = new Date().toISOString().slice(0, 10);

await db.collection('system-metrics').doc('reports-orchestrator')
  .collection('daily').doc(today)
  .set({
    reportsGenerated: admin.firestore.FieldValue.increment(generated),
    reportsDelivered: admin.firestore.FieldValue.increment(delivered),
    reportsFailed: admin.firestore.FieldValue.increment(failed),
    runs: admin.firestore.FieldValue.increment(1)
  }, { merge: true });
```

**Where:** In `writeHeartbeat()` function in `reports-orchestrator.js`, after the heartbeat write.  
**Frequency:** Once daily (02:00 IST)

---

## 5. Daily Prism Calc (Node.js)

**Doc:** `system-metrics/daily-prism-calc/daily/{date}`

```js
const today = new Date().toISOString().slice(0, 10);

await db.collection('system-metrics').doc('daily-prism-calc')
  .collection('daily').doc(today)
  .set({
    sensorsProcessed: admin.firestore.FieldValue.increment(processed),
    sensorsFailed: admin.firestore.FieldValue.increment(failed),
    runs: admin.firestore.FieldValue.increment(1)
  }, { merge: true });
```

**Where:** In `writeHeartbeat()` function in `orchestrator/index.js`, after the heartbeat write.  
**Frequency:** Once daily (00:05 IST)

---

## Critical Rules

1. **Always use `FieldValue.increment()`** — atomic, safe for concurrent writes
2. **Always use `merge: true` / `SetOptions.MergeAll`** — don't overwrite existing fields
3. **Wrap in the same try/catch as heartbeat** — never crash the service
4. **Date key uses UTC** (`YYYY-MM-DD`) — consistent across timezones
5. **Rotation handled by watchdog** — `rotation.ts` deletes `system-metrics/*/daily/*` > 30 days (already implemented)

---

## Expected Result in Firestore

```
system-metrics/
├── mqtt-bridge/
│   └── daily/
│       ├── 2026-05-19  { messagesReceived: 4320, errors: 0, cycles: 288 }
│       ├── 2026-05-18  { messagesReceived: 4100, errors: 2, cycles: 288 }
│       └── ...
├── ats-ingestion/
│   └── daily/
│       ├── 2026-05-19  { emailsFound: 8, emailsProcessed: 8, emailsFailed: 0, sensorsUpdated: 36, cycles: 12 }
│       └── ...
├── vibration-processor/
│   └── daily/
│       ├── 2026-05-19  { samplesFound: 1200, samplesProcessed: 1195, samplesFailed: 5, dinAlerts: 2, cycles: 720 }
│       └── ...
├── reports-orchestrator/
│   └── daily/
│       ├── 2026-05-19  { reportsGenerated: 8, reportsDelivered: 8, reportsFailed: 0, runs: 1 }
│       └── ...
└── daily-prism-calc/
    └── daily/
        ├── 2026-05-19  { sensorsProcessed: 24, sensorsFailed: 0, runs: 1 }
        └── ...
```

---

## UI (optional follow-up)

The admin page can later add a "30-day history" section reading these docs — sparklines or a simple table per service. Not required now.
