# Watchdog Service — Implementation Task

## Context

This is a Cloud Run service triggered by Cloud Scheduler at 3 intervals (5min, 15min, daily).
It reads heartbeat documents from Firestore, queries GCP APIs, evaluates health, manages incidents, and sends WhatsApp alerts.

For full system context, see: [System Monitoring Design](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/system-monitoring-design.md)  
For detailed per-component specs: [Monitoring Checks](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/monitoring-checks.md)  
Local path (if cloned): `../scanin-handbook/docs/monitoring/`

---

## Tech Stack

- **Runtime:** Node.js (TypeScript)
- **Framework:** Express (single POST endpoint triggered by Scheduler)
- **Deployment:** Cloud Run (dataloggerdev project, us-central1)
- **Firestore:** Same database as main app (dataloggerdev)
- **Alerts:** Green API (WhatsApp) — same instance as existing threshold alerts

---

## Endpoints

```
POST /check?tier=critical    ← Cloud Scheduler every 5 min
POST /check?tier=high        ← Cloud Scheduler every 15 min
POST /check?tier=daily       ← Cloud Scheduler at 07:00 IST
```

---

## What Each Tier Does

### Critical (every 5 min)
1. Read `system-heartbeats/mqtt-bridge`
2. Check `lastSeenAt` staleness → warning > 7 min, critical > 15 min
3. Check `connectedToMqtt` → critical if false
4. Check `lastFirestoreWriteAt` → warning > 1h, critical > 2h
5. Check `brokerClientsConnected` → warning < 3, critical = 0
6. (Optional) GCP Compute API → check bridge VM status

### High (every 15 min)
1. Read `system-heartbeats/ats-ingestion` → staleness warning > 2h, critical > 6h
2. Read `system-heartbeats/vibration-processor` → staleness warning > 30min, critical > 2h
3. GCP Cloud Monitoring API:
   - `checkThresholds` execution count + error rate (last 1h)
   - `handleAlerts` execution count + error rate (last 1h)
   - `evaluateMultiSensorRules` error rate (last 1h)
   - `scheduleCalcSensors` last execution time
4. **Write function stats to Firestore** → `system-heartbeats/firebase-functions` (so UI can display them)
5. If bridge heartbeat is stale → suppress function alerts (expected: no data = no triggers)

#### Firebase Functions Heartbeat (written BY the watchdog)

After querying GCP Monitoring API, write a summary doc so the admin UI can display function stats without needing GCP API access:

**Doc:** `system-heartbeats/firebase-functions`

```ts
{
  schemaVersion: 1,
  serviceName: "firebase-functions",
  lastSeenAt: ServerTimestamp,       // when watchdog last checked
  status: "healthy" | "warning" | "error",  // error if any function has high error rate

  functions: {
    checkThresholds: { executions: 48, errors: 0 },
    handleAlerts: { executions: 12, errors: 0 },
    evaluateMultiSensorRules: { executions: 12, errors: 0 },
    scheduleCalcSensors: { executions: 2, errors: 0 },
    cleanUnconfirmedSensors: { executions: 1, errors: 0 }
  }
}
```

**Status logic:**
- `error`: any function has error rate > 20% in last hour
- `warning`: any function has error rate > 5% or zero executions when expected
- `healthy`: all functions running normally

### Daily (07:00 IST)
1. Read `system-heartbeats/reports-orchestrator` → did it run today?
2. Read `system-heartbeats/prism-orchestrator` → did it run today?
3. GCP Cloud Monitoring API → `cleanUnconfirmedSensors` ran in last 25h?
4. Firestore Admin API → latest backup < 25h?
5. Rotate old metrics: delete `system-metrics/*/daily/*` older than 30 days
6. Rotate old incidents: delete resolved incidents older than 90 days
7. Send daily summary via WhatsApp: "All OK" or "N issues: [list]"

---

## Core Logic Flow

```
1. Read tier from request
2. Read maintenance docs → skip components in maintenance
3. Run checks for that tier
4. For each check result:
   a. Read previous state from system-checks/{checkId}
   b. Compare: same? changed? new?
   c. If degraded → create/update incident
   d. If recovered → close incident
   e. Overwrite system-checks/{checkId}
5. For each open incident:
   a. Check dedup rules (last alert time, reminder intervals)
   b. Send alert if needed (WhatsApp)
   c. Append event to incident timeline
6. Return 200 with summary
```

---

## Firestore Collections Used

### Read
```
system-heartbeats/{serviceName}      ← written by services
system-checks/{checkId}              ← own previous state
system-incidents/{id}                ← open incidents
system-maintenance/{component}       ← maintenance mode
```

### Write
```
system-heartbeats/firebase-functions ← function stats (written by watchdog after GCP query)
system-checks/{checkId}              ← overwrite with latest result
system-incidents/{id}                ← create/update/close
system-incidents/{id}/events/{ts}    ← incident timeline
system-metrics/{component}/daily/{date}  ← daily snapshot (daily tier only)
```

---

## Check Result Schema

```ts
interface CheckResult {
  checkId: string;            // "bridge_heartbeat_stale"
  component: string;          // "mqtt-bridge"
  status: "ok" | "warning" | "critical";
  message: string;            // "Bridge heartbeat is 12 min old"
  confidence: "high" | "medium" | "low";
  severity: "critical" | "high" | "medium";
  dedupeKey: string;          // "bridge_down"
  observedAt: Timestamp;
  lastHealthyAt: Timestamp;
}
```

---

## Incident Schema

```ts
interface Incident {
  id: string;                 // auto-generated
  component: string;          // "mqtt-bridge"
  dedupeKey: string;          // "bridge_down"
  status: "open" | "resolved";
  severity: "critical" | "high" | "medium";
  openedAt: Timestamp;
  resolvedAt?: Timestamp;
  lastAlertSentAt?: Timestamp;
  alertCount: number;
  latestMessage: string;
}
```

---

## Alert Dedup Rules

```ts
const ALERT_RULES = {
  firstAlert: 0,              // immediate on first failure
  reminderAfterMs: 30 * 60 * 1000,    // 30 min
  escalationAfterMs: 2 * 60 * 60 * 1000, // 2 hours
  maxAlertsPerIncident: 5     // then only daily summary
};
```

---

## WhatsApp Alert Format

```
🔴 ScanIn Alert: Bridge Down
Bridge heartbeat stale (15 min).
Last data at: 22:45.
---
⚠️ ScanIn Warning: ATS Ingestion
No heartbeat for 3 hours.
---
✅ ScanIn Resolved: Bridge
Bridge writing again. Downtime: 23 min.
---
📋 ScanIn Daily Summary (07:00)
✅ Bridge: healthy (144 msgs/5min)
✅ ATS: healthy (checked 5 min ago)
⚠️ Vibration: no heartbeat (3h) — low confidence
✅ Reports: ran at 02:14, 8 reports sent
✅ Prism: ran at 00:08, 24 sensors
✅ Functions: 342 runs, 0 errors
✅ Backups: latest 6h ago
✅ Cleanup: ran yesterday
```

---

## Environment Variables

```
GOOGLE_CLOUD_PROJECT=dataloggerdev
GREEN_API_SEND_MESSAGE_URL=<from existing functions>
GREEN_API_CHAT_ID=<monitoring recipient(s)>
ALERT_RECIPIENT_PHONE=<your phone number>
```

---

## Project Structure (suggested)

```
scanin-svc-watchdog/
├── src/
│   ├── index.ts              # Express app, POST /check
│   ├── checks/
│   │   ├── bridge.ts         # Read heartbeat, evaluate
│   │   ├── ats.ts
│   │   ├── vibration.ts
│   │   ├── functions.ts      # GCP Monitoring API
│   │   ├── daily-jobs.ts     # Reports, prism, cleanup
│   │   ├── backups.ts        # Firestore Admin API
│   │   └── vm-status.ts      # GCP Compute API
│   ├── incidents/
│   │   ├── manager.ts        # Create/update/resolve incidents
│   │   └── dedup.ts          # Alert timing rules
│   ├── alerts/
│   │   ├── whatsapp.ts       # Green API sender
│   │   └── formatter.ts      # Message templates
│   ├── maintenance.ts        # Check maintenance mode
│   ├── rotation.ts           # Delete old metrics/incidents
│   └── constants.ts          # Collection paths, thresholds, schema version
├── Dockerfile
├── deploy.sh
├── package.json
├── tsconfig.json
└── README.md
```

---

## Deploy

```bash
gcloud run deploy scanin-watchdog \
  --source . \
  --project dataloggerdev \
  --region us-central1 \
  --no-allow-unauthenticated \
  --service-account <TBD>

# Scheduler jobs
gcloud scheduler jobs create http watchdog-critical \
  --schedule="*/5 * * * *" \
  --uri="https://scanin-watchdog-<hash>.run.app/check?tier=critical" \
  --http-method=POST \
  --oidc-service-account-email=<TBD>

gcloud scheduler jobs create http watchdog-high \
  --schedule="*/15 * * * *" \
  --uri="https://scanin-watchdog-<hash>.run.app/check?tier=high" \
  --http-method=POST \
  --oidc-service-account-email=<TBD>

gcloud scheduler jobs create http watchdog-daily \
  --schedule="0 4 * * *" \
  --time-zone="Asia/Jerusalem" \
  --uri="https://scanin-watchdog-<hash>.run.app/check?tier=daily" \
  --http-method=POST \
  --oidc-service-account-email=<TBD>
```

---

## Open Questions for Implementation

1. Green API chat ID for monitoring alerts — same group as threshold alerts or separate?
2. Service account — needs Firestore read/write + Monitoring Viewer + Compute Viewer roles.
3. Should we add a `/health` endpoint on the watchdog itself? (meta-monitoring)
