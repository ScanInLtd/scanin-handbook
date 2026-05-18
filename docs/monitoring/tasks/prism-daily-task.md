# Daily Prism Calculation — Heartbeat Implementation Task

## Context

ScanIn is an IoT monitoring platform. All services self-report heartbeats to a shared Firestore collection. A Cloud Run watchdog reads these heartbeats and sends alerts if services go silent.

The daily prism calculation runs at 00:05 IST (Cloud Scheduler → `daily-prism-orchestrator` → `daily-prism-worker`). The watchdog checks at 07:00 IST whether it ran today.

Full design docs:
- [System Monitoring Design](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/system-monitoring-design.md)
- [Per-Component Check Specs](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/monitoring-checks.md)

---

## What This Service Is

`daily-prism-orchestrator` + `daily-prism-worker` are Node.js Cloud Run services (project `dataloggerdev`, region `us-central1`). They:
1. Run daily at 00:05 IST via Cloud Scheduler
2. Calculate a smart daily average for each prism sensor
3. Write the calculated displacement values to Firestore
4. Already have Firestore access

**Existing endpoints:** `GET /health`, `POST /scheduledRun`, `POST /runDaily`, `POST /runNow`

---

## What To Add

A single heartbeat write at the end of the orchestrator run (after all prism sensors are processed).

### Heartbeat Document

**Doc path:** `system-heartbeats/daily-prism-calc`  
**Operation:** Overwrite (`.set()`)

```ts
import { FieldValue } from 'firebase-admin/firestore';

await db.collection('system-heartbeats').doc('daily-prism-calc').set({
  schemaVersion: 1,
  serviceName: 'daily-prism-calc',
  lastSeenAt: FieldValue.serverTimestamp(),
  version: '1.0.0',  // or from package.json
  status: computeStatus(processed, failed),

  lastRunAt: FieldValue.serverTimestamp(),
  lastRunStatus: failed > 0 ? (processed > 0 ? 'partial' : 'error') : 'success',
  sensorsProcessed: processed,   // prism sensors calculated this run
  sensorsFailed: failed,         // failed to calculate
  durationMs: Date.now() - startTime
});
```

### Status Logic

```ts
function computeStatus(processed: number, failed: number): string {
  if (failed > 0 && processed === 0) return 'error';
  if (failed > 0) return 'warning';
  return 'healthy';
}
```

---

## Where To Add Code

Look for the orchestrator's main run function — the one triggered by `/scheduledRun` from Cloud Scheduler. At the end, after all workers have finished:

```ts
// Pseudo-location (in the scheduledRun handler):
const startTime = Date.now();
let processed = 0, failed = 0;

try {
  // ... existing orchestration logic ...
  // Track counts as sensors are processed
} catch (err) {
  // ... existing error handling ...
} finally {
  await writeHeartbeat(processed, failed, startTime);
}
```

### Heartbeat Writer

```ts
async function writeHeartbeat(processed: number, failed: number, startTime: number) {
  try {
    await db.collection('system-heartbeats').doc('daily-prism-calc').set({
      schemaVersion: 1,
      serviceName: 'daily-prism-calc',
      lastSeenAt: FieldValue.serverTimestamp(),
      version: process.env.npm_package_version || '1.0.0',
      status: failed > 0 ? (processed > 0 ? 'warning' : 'error') : 'healthy',
      lastRunAt: FieldValue.serverTimestamp(),
      lastRunStatus: failed > 0 ? (processed > 0 ? 'partial' : 'error') : 'success',
      sensorsProcessed: processed,
      sensorsFailed: failed,
      durationMs: Date.now() - startTime
    });
  } catch (err) {
    console.error('Heartbeat write failed:', err.message);
  }
}
```

---

## Critical Rules

1. **Use `FieldValue.serverTimestamp()`** for `lastSeenAt` and `lastRunAt`
2. **Heartbeat write must be try/catch** — never crash after successful processing
3. **Overwrite, don't accumulate** — always `.set()` the same doc
4. **Write once per run** — not per sensor, just once at the end

---

## Dependencies

Already uses `firebase-admin` with Firestore. No new packages needed.

---

## Watchdog Behavior

The watchdog checks this heartbeat in the **daily tier** (07:00 IST):
- If `lastRunAt` is not today → **critical** (daily calc didn't run)
- If `lastRunStatus` is `"partial"` → **warning**
- If `lastRunStatus` is `"error"` → **critical**

---

## Testing

After deployment:
1. Trigger via `POST /runNow` or wait for 00:05 IST
2. Check Firestore → `system-heartbeats/daily-prism-calc` doc exists
3. Verify `sensorsProcessed` reflects actual sensor count
4. Admin UI → card shows green with last run time

---

## Deployment

Standard Cloud Run deploy:
```bash
gcloud run deploy daily-prism-orchestrator --source . --project dataloggerdev --region us-central1
```

---

## Estimated Effort

~10 lines of TypeScript. No new dependencies.
