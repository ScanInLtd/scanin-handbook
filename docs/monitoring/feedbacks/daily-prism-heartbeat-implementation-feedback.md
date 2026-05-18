# Heartbeat Implementation — Feedback

## Status: Done

Implemented exactly as specified in `prism-daily-task.md`.

## What Was Added

- `writeHeartbeat(processed, failed, startTime)` function in `orchestrator/index.js`
- Called in `finally` block of `/scheduledRun` endpoint — writes once per run regardless of success/failure
- Writes to `system-heartbeats/daily-prism-calc` using `.set()` (overwrite)

## Document Written

```
system-heartbeats/daily-prism-calc
├── schemaVersion: 1
├── serviceName: 'daily-prism-calc'
├── lastSeenAt: serverTimestamp
├── version: '1.0.0'
├── status: 'healthy' | 'warning' | 'error'
├── lastRunAt: serverTimestamp
├── lastRunStatus: 'success' | 'partial' | 'error'
├── sensorsProcessed: <count of published jobs>
├── sensorsFailed: <0 or 1 if orchestrator threw>
└── durationMs: <elapsed ms>
```

## Notes / Deviations

- `processed` = number of Pub/Sub messages published (i.e., sensors sent to the worker). This is the orchestrator's perspective — it doesn't wait for worker completion.
- `failed` = 1 only if the orchestrator itself throws (can't reach Firestore, can't publish to Pub/Sub). Individual worker failures are not tracked here since they run asynchronously via Pub/Sub.
- Heartbeat is wrapped in try/catch — will never crash the service.

## Testing

After deploy:
```bash
# Trigger a run
curl -X POST https://daily-prism-orchestrator-hqaprow6pq-uc.a.run.app/scheduledRun

# Check the heartbeat doc in Firestore
# Path: system-heartbeats/daily-prism-calc
```

Or wait for tonight's 00:05 IST scheduled run, then check the doc.
