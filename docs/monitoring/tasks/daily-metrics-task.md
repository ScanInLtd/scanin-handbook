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

## 6. Web App Admin UI (Angular) — 30-Day Metrics Visualization

**Task:** Replace the plain tables with a modern chart-based dashboard for the 30-day service metrics. Use a charting library (e.g., `ngx-charts`, `chart.js` via `ng2-charts`, or `lightweight-charts`) to make the data visually useful.

**Collection pattern:** `system-metrics/{serviceName}/daily/{YYYY-MM-DD}`

**Services and their primary metric:**

| Service | Primary metric (chart) | Secondary (tooltip/badge) |
|---|---|---|
| mqtt-bridge | `messagesReceived` (bar/area chart) | `errors` (red dots on days with errors) |
| ats-ingestion | `emailsProcessed` (bar chart) | `emailsFailed` (red overlay) |
| vibration-processor | `samplesProcessed` (area chart) | `samplesFailed`, `dinAlerts` |
| reports-orchestrator | `reportsDelivered` (bar chart) | `reportsFailed` |
| daily-prism-calc | `sensorsProcessed` (bar chart) | `sensorsFailed` |

---

### Design Requirements

**Layout:**
- Below the existing service cards, add a "30-Day Activity" section
- One chart card per service, arranged in a responsive grid (2 columns on desktop, 1 on mobile)
- Each card has: service name, a mini area/bar chart (30 bars = 30 days), and a summary line

**Chart style:**
- Use small area charts or bar charts (not full-page — think sparkline-sized, ~120px height)
- X-axis: dates (show only every 7th label to avoid clutter)
- Y-axis: auto-scaled, no grid lines (clean look)
- Color: green fill for success metrics, red accent for failures
- Hover/tooltip: show exact numbers for that day

**Summary line below each chart:**
```
Today: 4,320 msgs | 30-day avg: 4,100 | Errors: 0
```

**Empty state:** If no data for a service, show a muted "No activity in last 30 days" with a flat gray line

**Error highlighting:**
- Days with failures > 0: show a small red dot or red bar segment
- If today has errors: card border turns amber/red (like the service cards above)

---

### Recommended Library

**`ng2-charts`** (Chart.js wrapper) — already widely used in Angular, lightweight, good defaults:

```bash
npm install ng2-charts chart.js
```

Or if you want something more minimal: **`sparkline-svg`** or inline SVG paths computed from the data.

---

### Data Fetching

```ts
// Query last 30 days for a service
async loadMetrics(serviceName: string): Promise<DayMetric[]> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startDate = thirtyDaysAgo.toISOString().slice(0, 10);

  const snapshot = await this.firestore
    .collection(`system-metrics/${serviceName}/daily`)
    .ref.where(firebase.firestore.FieldPath.documentId(), '>=', startDate)
    .orderBy(firebase.firestore.FieldPath.documentId())
    .get();

  return snapshot.docs.map(doc => ({ date: doc.id, ...doc.data() }));
}
```

**Load once on page init** (not real-time — daily data doesn't change live). Cache in component state.

---

### Chart.js Config Example (per service card)

```ts
// Bar chart for messagesReceived
chartData = {
  labels: days.map(d => d.date.slice(5)), // "05-19"
  datasets: [
    {
      data: days.map(d => d.messagesReceived || 0),
      backgroundColor: '#4ade80',  // green
      borderRadius: 3,
      barPercentage: 0.7
    },
    {
      data: days.map(d => d.errors || 0),
      backgroundColor: '#f87171',  // red
      borderRadius: 3,
      barPercentage: 0.7
    }
  ]
};

chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { maxTicksLimit: 5 } },
    y: { grid: { display: false }, beginAtZero: true }
  }
};
```

---

### Visual Mockup (text)

```
┌─────────────────────────────────────────┐
│  MQTT Bridge                            │
│  ▁▂▃▅▇█▇▅▆▇█▇▅▃▂▃▅▇█▇▅▆▇█▇▅▃▂▃▅     │
│  Today: 4,320 msgs | Avg: 4,100 | 0 err│
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│  Vibration                              │
│  ▁▂▃▅▇█▇▅▆▇█▇▅▃▂▃▅▇█▇▅▆▇█▇▅▃▂▃▅     │
│  Today: 1,200 samples | Avg: 1,150 | 5🔴│
└─────────────────────────────────────────┘
```

---

**Priority:** Medium — improves usability significantly. Implement after heartbeats are stable (a few days of data).

---

## 7. Watchdog — Firebase Functions Daily Metrics (TypeScript)

**Task:** The watchdog already queries GCP Monitoring API for Firebase Functions stats (every 15 min, high tier) and writes to `system-heartbeats/firebase-functions`. It should ALSO write a daily metrics increment so the UI can chart 30-day activity.

**Doc:** `system-metrics/firebase-functions/daily/{YYYY-MM-DD}`  
**Where:** In `checks/functions.ts`, after writing the heartbeat doc.  
**Frequency:** Every 15 min (high tier) — increments accumulate through the day.

**Rules:**
- Use `FieldValue.increment()` — never overwrite, always increment
- Use `{ merge: true }` — don't clobber other fields
- Wrap in try/catch — never crash the check cycle

```ts
// After writing system-heartbeats/firebase-functions, also increment daily metrics:
const today = new Date().toISOString().slice(0, 10);

const totalInvocations = Object.values(functionStats).reduce((sum, f) => sum + f.executions, 0);
const totalErrors = Object.values(functionStats).reduce((sum, f) => sum + f.errors, 0);

await db.collection('system-metrics').doc('firebase-functions')
  .collection('daily').doc(today)
  .set({
    totalInvocations: FieldValue.increment(totalInvocations),
    totalErrors: FieldValue.increment(totalErrors),
    checks: FieldValue.increment(1)  // how many times watchdog checked today
  }, { merge: true });
```

---

## 8. Watchdog — Rotation & Daily Summary (TypeScript)

**Task:** The watchdog's `rotation.ts` already deletes old docs from `system-metrics/*/daily/*` older than 30 days. Verify the rotation logic covers all 6 services (including firebase-functions). Additionally, the daily summary alert (07:00 IST WhatsApp) can now include yesterday's stats.

**Verify rotation covers all 6 services:**

```ts
const services = [
  'mqtt-bridge',
  'ats-ingestion',
  'vibration-processor',
  'reports-orchestrator',
  'daily-prism-calc',
  'firebase-functions'
];

// For each service, delete system-metrics/{svc}/daily/{date} where date < today - 30
```

**Daily summary enhancement (optional):**

In the daily tier, after checks pass, read yesterday's metrics and include in the WhatsApp message:

```ts
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const dateStr = yesterday.toISOString().slice(0, 10);

const services = ['mqtt-bridge', 'ats-ingestion', 'vibration-processor', 'reports-orchestrator', 'daily-prism-calc', 'firebase-functions'];

const lines: string[] = [];
for (const svc of services) {
  const doc = await db.collection('system-metrics').doc(svc)
    .collection('daily').doc(dateStr).get();
  if (doc.exists) {
    const d = doc.data();
    // Example formatting:
    // "Bridge: 4320 msgs, 0 errors"
    // "Functions: 724 invocations, 0 errors"
    lines.push(formatStats(svc, d));
  }
}
// Append to daily WhatsApp summary
```

**Priority:** Rotation = critical (prevents unbounded storage growth). Daily summary stats = nice-to-have.

---

## 9. Web App UI — Firebase Functions Config

**Task:** Apply these settings for the `firebase-functions` service card and chart.

### Staleness Thresholds

The watchdog writes to `system-heartbeats/firebase-functions` every 15 minutes.

| Warning | Critical |
|---|---|
| > 20 min | > 45 min |

### Card Label

Display as: **"Firebase Functions"** (not the raw doc ID `firebase-functions`)

### 30-Day Chart

| Setting | Value |
|---|---|
| Doc path | `system-metrics/firebase-functions/daily/{date}` |
| Primary metric (green bar) | `totalInvocations` |
| Failure metric (red highlight) | `totalErrors` |
| Summary line | `Today: X invocations | Avg: Y | Z errors` |
