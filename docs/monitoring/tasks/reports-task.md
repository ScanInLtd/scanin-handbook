# Reports Orchestrator — Heartbeat Implementation Task

## Context

ScanIn is an IoT monitoring platform. All services self-report heartbeats to a shared Firestore collection. A Cloud Run watchdog reads these heartbeats and sends alerts if services go silent.

The reports pipeline runs daily at 02:00 IST (Cloud Scheduler → `reports-orchestrator` → `reports-worker`). The watchdog checks at 07:00 IST whether it ran today.

Full design docs:
- [System Monitoring Design](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/system-monitoring-design.md)
- [Per-Component Check Specs](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/monitoring-checks.md)

---

## What This Service Is

`reports-orchestrator` is a Node.js Cloud Run service (project `dataloggerdev`, region `us-central1`). It:
1. Receives a trigger from Cloud Scheduler daily at 02:00 IST
2. Determines which reports need generating
3. Calls `reports-worker` to generate PDFs and send via SendGrid
4. Already has Firestore access (reads sensor data, config)

**Existing endpoints:** `GET /` (status)

---

## What To Add

A single heartbeat write at the end of the orchestrator run (after all reports are generated/delivered or failed).

### Heartbeat Document

**Doc path:** `system-heartbeats/reports-orchestrator`  
**Operation:** Overwrite (`.set()`)

```ts
import { FieldValue } from 'firebase-admin/firestore';

// At the end of the orchestration run:
await db.collection('system-heartbeats').doc('reports-orchestrator').set({
  schemaVersion: 1,
  serviceName: 'reports-orchestrator',
  lastSeenAt: FieldValue.serverTimestamp(),
  version: '1.0.0',  // or from package.json
  status: computeStatus(generated, delivered, failed),

  lastRunAt: FieldValue.serverTimestamp(),
  lastRunStatus: failed > 0 ? (delivered > 0 ? 'partial' : 'error') : 'success',
  reportsGenerated: generated,   // total reports generated this run
  reportsDelivered: delivered,   // successfully sent via SendGrid
  reportsFailed: failed,         // failed to generate or deliver
  durationMs: Date.now() - startTime
});
```

### Status Logic

```ts
function computeStatus(generated: number, delivered: number, failed: number): string {
  if (failed > 0 && delivered === 0) return 'error';
  if (failed > 0) return 'warning';
  return 'healthy';
}
```

---

## Where To Add Code

Look for the main orchestration function — the one triggered by the scheduler (likely the `/trigger` route or equivalent). At the end, after all workers have finished:

```ts
// Pseudo-location:
app.post('/trigger', async (req, res) => {
  const startTime = Date.now();
  let generated = 0, delivered = 0, failed = 0;

  try {
    // ... existing orchestration logic ...
    // Track counts as reports complete
  } catch (err) {
    // ... existing error handling ...
  } finally {
    // ALWAYS write heartbeat
    await writeHeartbeat(generated, delivered, failed, startTime);
  }

  res.json({ generated, delivered, failed });
});
```

### Heartbeat Writer

```ts
async function writeHeartbeat(generated: number, delivered: number, failed: number, startTime: number) {
  try {
    await db.collection('system-heartbeats').doc('reports-orchestrator').set({
      schemaVersion: 1,
      serviceName: 'reports-orchestrator',
      lastSeenAt: FieldValue.serverTimestamp(),
      version: process.env.npm_package_version || '1.0.0',
      status: failed > 0 ? (delivered > 0 ? 'warning' : 'error') : 'healthy',
      lastRunAt: FieldValue.serverTimestamp(),
      lastRunStatus: failed > 0 ? (delivered > 0 ? 'partial' : 'error') : 'success',
      reportsGenerated: generated,
      reportsDelivered: delivered,
      reportsFailed: failed,
      durationMs: Date.now() - startTime
    });
  } catch (err) {
    console.error('Heartbeat write failed:', err.message);
    // Do NOT crash — report pipeline already finished
  }
}
```

---

## Critical Rules

1. **Use `FieldValue.serverTimestamp()`** for `lastSeenAt` and `lastRunAt`
2. **Heartbeat write must be try/catch** — if Firestore write fails, the reports were still delivered
3. **Overwrite, don't accumulate** — always `.set()` the same doc
4. **Write once per run** — not per report, just once at the end of the entire orchestration

---

## Dependencies

The service already uses `firebase-admin` and has Firestore access. No new packages needed. Just import `FieldValue` if not already imported.

---

## Watchdog Behavior

The watchdog checks this heartbeat in the **daily tier** (07:00 IST):
- If `lastRunAt` is not today → **critical** (reports didn't run)
- If `lastRunStatus` is `"partial"` → **warning**
- If `lastRunStatus` is `"error"` → **critical**

---

## Testing

After deployment:
1. Trigger the orchestrator manually (or wait for 02:00 IST)
2. Check Firestore → `system-heartbeats/reports-orchestrator` doc exists
3. Verify `lastRunAt` and `reportsGenerated` reflect actual results
4. In admin UI → service card should show green with "Last seen: Xm ago"

---

## Deployment

Standard Cloud Run deploy (same as current process):
```bash
gcloud run deploy reports-orchestrator --source . --project dataloggerdev --region us-central1
```

---

## Estimated Effort

~10 lines of TypeScript. No new dependencies. No architectural changes.
