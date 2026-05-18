# Daily Metrics — All Services

Each section below is self-contained — copy-paste directly to the relevant repo.

---

## 1. MQTT Bridge (Node.js)

**Task:** Add a daily metrics write alongside the existing heartbeat. This creates a 30-day history of activity that the admin UI can display as trends. One doc per day, using atomic increments (safe for concurrent writes). Docs older than 30 days are auto-deleted by the watchdog service.

**Doc:** `system-metrics/mqtt-bridge/daily/{YYYY-MM-DD}`  
**Where:** In `heartbeatService.js`, right after the heartbeat write (inside the same try/catch).  
**Frequency:** Every 5 min (~288 writes/day)

**Rules:**
- Use `FieldValue.increment()` — never overwrite, always increment
- Use `{ merge: true }` — don't clobber other fields
- Wrap in try/catch — never crash the service if this fails

```js
// Add right after the heartbeat write:
const today = new Date().toISOString().slice(0, 10); // "2026-05-19"

await db.collection('system-metrics').doc('mqtt-bridge')
  .collection('daily').doc(today)
  .set({
    messagesReceived: admin.firestore.FieldValue.increment(messagesThisCycle),
    errors: admin.firestore.FieldValue.increment(errorsThisCycle),
    cycles: admin.firestore.FieldValue.increment(1)
  }, { merge: true });
```

---

## 2. ATS Ingestion (C#)

**Task:** Add a daily metrics write alongside the existing heartbeat. This creates a 30-day history of activity that the admin UI can display as trends. One doc per day, using atomic increments (safe for concurrent writes). Docs older than 30 days are auto-deleted by the watchdog service.

**Doc:** `system-metrics/ats-ingestion/daily/{YYYY-MM-DD}`  
**Where:** In `WriteHeartbeatAsync()`, right after the heartbeat `.SetAsync()`.  
**Frequency:** Every email check cycle (~12/day)

**Rules:**
- Use `FieldValue.Increment()` — never overwrite, always increment
- Use `SetOptions.MergeAll` — don't clobber other fields
- Already inside try/catch from heartbeat — no extra handling needed

```csharp
// Add right after the heartbeat SetAsync:
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

---

## 3. Vibration Processor (C#)

**Task:** Add a daily metrics write alongside the existing heartbeat. This creates a 30-day history of activity that the admin UI can display as trends. One doc per day, using atomic increments (safe for concurrent writes). Docs older than 30 days are auto-deleted by the watchdog service.

**Doc:** `system-metrics/vibration-processor/daily/{YYYY-MM-DD}`  
**Where:** In `HeartbeatWriter.WriteAsync()`, right after the heartbeat `.SetAsync()`.  
**Frequency:** Every 2 min (~720/day)

**Rules:**
- Use `FieldValue.Increment()` — never overwrite, always increment
- Use `SetOptions.MergeAll` — don't clobber other fields
- Already inside try/catch from heartbeat — no extra handling needed

```csharp
// Add right after the heartbeat SetAsync:
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

---

## 4. Reports Orchestrator (Node.js)

**Task:** Add a daily metrics write alongside the existing heartbeat. This creates a 30-day history of activity that the admin UI can display as trends. One doc per day, using atomic increments (safe for concurrent writes). Docs older than 30 days are auto-deleted by the watchdog service.

**Doc:** `system-metrics/reports-orchestrator/daily/{YYYY-MM-DD}`  
**Where:** In `writeHeartbeat()` function in `reports-orchestrator.js`, after the heartbeat write.  
**Frequency:** Once daily (02:00 IST)

**Rules:**
- Use `FieldValue.increment()` — never overwrite, always increment
- Use `{ merge: true }` — don't clobber other fields
- Already inside try/catch from heartbeat — no extra handling needed

```js
// Add right after the heartbeat .set():
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

---

## 5. Daily Prism Calc (Node.js)

**Task:** Add a daily metrics write alongside the existing heartbeat. This creates a 30-day history of activity that the admin UI can display as trends. One doc per day, using atomic increments (safe for concurrent writes). Docs older than 30 days are auto-deleted by the watchdog service.

**Doc:** `system-metrics/daily-prism-calc/daily/{YYYY-MM-DD}`  
**Where:** In `writeHeartbeat()` function in `orchestrator/index.js`, after the heartbeat write.  
**Frequency:** Once daily (00:05 IST)

**Rules:**
- Use `FieldValue.increment()` — never overwrite, always increment
- Use `{ merge: true }` — don't clobber other fields
- Already inside try/catch from heartbeat — no extra handling needed

```js
// Add right after the heartbeat .set():
const today = new Date().toISOString().slice(0, 10);

await db.collection('system-metrics').doc('daily-prism-calc')
  .collection('daily').doc(today)
  .set({
    sensorsProcessed: admin.firestore.FieldValue.increment(processed),
    sensorsFailed: admin.firestore.FieldValue.increment(failed),
    runs: admin.firestore.FieldValue.increment(1)
  }, { merge: true });
```

---

## 6. Web App Admin UI (Angular)

**Task:** The services now write daily metrics to `system-metrics/{serviceName}/daily/{YYYY-MM-DD}`. Add a "30-day history" section to the System Monitoring admin page that reads these docs and displays trends per service.

**Collection pattern:** `system-metrics/{serviceName}/daily/{date}`

**Services and their fields:**

| Service | Doc ID | Fields |
|---|---|---|
| mqtt-bridge | `system-metrics/mqtt-bridge/daily/*` | `messagesReceived`, `errors`, `cycles` |
| ats-ingestion | `system-metrics/ats-ingestion/daily/*` | `emailsFound`, `emailsProcessed`, `emailsFailed`, `sensorsUpdated`, `cycles` |
| vibration-processor | `system-metrics/vibration-processor/daily/*` | `samplesFound`, `samplesProcessed`, `samplesFailed`, `dinAlerts`, `cycles` |
| reports-orchestrator | `system-metrics/reports-orchestrator/daily/*` | `reportsGenerated`, `reportsDelivered`, `reportsFailed`, `runs` |
| daily-prism-calc | `system-metrics/daily-prism-calc/daily/*` | `sensorsProcessed`, `sensorsFailed`, `runs` |

**How to read (query last 30 days):**

```ts
// Option A: query subcollection by doc ID range (efficient)
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
const startDate = thirtyDaysAgo.toISOString().slice(0, 10);

const snapshot = await this.firestore
  .collection(`system-metrics/${serviceName}/daily`)
  .ref.where(firebase.firestore.FieldPath.documentId(), '>=', startDate)
  .orderBy(firebase.firestore.FieldPath.documentId())
  .get();

const days = snapshot.docs.map(doc => ({ date: doc.id, ...doc.data() }));
```

**Display suggestions:**
- Simple table: one row per day, columns = key metrics
- Sparklines on service cards showing 7-day or 30-day trend
- Color cells red if `*Failed` > 0 that day

**Priority:** Low — read-only, cosmetic. Can be added after core monitoring is stable.

---

## 7. Watchdog (Cloud Run, TypeScript)

**Task:** The watchdog's `rotation.ts` already deletes old docs from `system-metrics/*/daily/*` older than 30 days. Verify the rotation logic covers the new service names. Additionally, the daily summary alert (07:00 IST WhatsApp) can now include yesterday's stats.

**Verify rotation covers all 5 services:**

```ts
const services = [
  'mqtt-bridge',
  'ats-ingestion',
  'vibration-processor',
  'reports-orchestrator',
  'daily-prism-calc'
];

// For each service, delete system-metrics/{svc}/daily/{date} where date < today - 30
```

**Daily summary enhancement (optional):**

In the daily tier, after checks pass, read yesterday's metrics and include in the WhatsApp message:

```ts
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const dateStr = yesterday.toISOString().slice(0, 10);

const services = ['mqtt-bridge', 'ats-ingestion', 'vibration-processor', 'reports-orchestrator', 'daily-prism-calc'];

const lines: string[] = [];
for (const svc of services) {
  const doc = await db.collection('system-metrics').doc(svc)
    .collection('daily').doc(dateStr).get();
  if (doc.exists) {
    const d = doc.data();
    // Example formatting:
    // "Bridge: 4320 msgs, 0 errors"
    // "ATS: 8 emails processed, 0 failed"
    lines.push(formatStats(svc, d));
  }
}
// Append to daily WhatsApp summary
```

**Priority:** Rotation = critical (prevents unbounded storage growth). Daily summary stats = nice-to-have.
