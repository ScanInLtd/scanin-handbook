# Web App — Monitoring Admin Page Task

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

## What To Build

A new admin-only page in the ScanIn web app showing system health at a glance. Read-only — no actions, just visibility.

**Route:** `/admin/monitoring` (or `/system-health`, your call based on existing routing)

---

## Data Sources (Firestore reads only)

| Collection | What to show |
|---|---|
| `system-heartbeats/{service}` | Service status cards — is it alive? latest metrics |
| `system-health/checks/{checkId}` | Individual check statuses (ok/warning/critical) |
| `system-health/incidents/{id}` | Active incidents list + resolved history |
| `system-maintenance/{component}` | Which components are in maintenance mode |

---

## Page Layout

### 1. Services Overview (top)

A row of cards, one per service:

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ 🟢 MQTT Bridge  │  │ 🟢 ATS          │  │ 🟡 Vibration    │
│ Last seen: 2m   │  │ Last seen: 15m  │  │ Last seen: 45m  │
│ 144 msgs/5min   │  │ 3 emails/run    │  │ 5 samples/run   │
│ 0 errors        │  │ 0 failures      │  │ 0 failures      │
└─────────────────┘  └─────────────────┘  └─────────────────┘

┌─────────────────┐  ┌─────────────────┐
│ 🟢 Reports      │  │ 🟢 Prism        │
│ Ran: 02:14      │  │ Ran: 00:08      │
│ 8 reports OK    │  │ 24 sensors OK   │
└─────────────────┘  └─────────────────┘
```

**Color logic:**
- 🟢 Green: `status == "healthy"` or `lastSeenAt` within expected interval
- 🟡 Yellow: `status == "warning"` or approaching staleness threshold
- 🔴 Red: `status == "error"` or heartbeat stale beyond critical threshold

**Staleness thresholds** (from check specs):
- Bridge: warning > 7 min, critical > 15 min
- ATS: warning > 2h, critical > 6h
- Vibration: warning > 30 min, critical > 2h
- Reports/Prism: critical if didn't run today (check after 07:00)

### 2. Health Checks Table (middle)

| Check | Component | Status | Message | Last Checked |
|---|---|---|---|---|
| bridge_heartbeat_stale | mqtt-bridge | ✅ OK | Heartbeat 2m old | 11:50 |
| bridge_mqtt_connected | mqtt-bridge | ✅ OK | Connected | 11:50 |
| ats_heartbeat_stale | ats-ingestion | ⚠️ Warning | 2.5h since last check | 11:45 |
| ... | ... | ... | ... | ... |

Read from `system-health/checks/{checkId}` — each doc has `status`, `message`, `observedAt`.

### 3. Active Incidents (if any)

```
🔴 Bridge Down — opened 22:30, 2 alerts sent
   Latest: "Bridge heartbeat stale (18 min)"
   
⚠️ ATS Stale — opened 20:15, 1 alert sent
   Latest: "No heartbeat for 3 hours"
```

Read from `system-health/incidents/{id}` where `status == "open"`.

### 4. Maintenance Mode (if active)

```
🔧 mqtt-bridge: maintenance until 2026-05-19 02:00 (reason: "Docker upgrade")
```

Read from `system-maintenance/{component}`.

### 5. Recent Incidents (bottom, collapsed/expandable)

Last 10 resolved incidents with timestamp, duration, component.

---

## Implementation Notes

- **Read-only** — no mutations, no buttons that trigger actions
- **Real-time optional** — Firestore `onSnapshot` listeners would auto-update, but polling every 30s is fine too
- **Admin-only** — gate behind existing admin role check
- **No new API endpoints needed** — read directly from Firestore client SDK
- **Responsive** — cards should stack on mobile

---

## Heartbeat Document Fields (for display)

### mqtt-bridge
```ts
{
  status, lastSeenAt, connectedToMqtt,
  messagesReceivedLast5m, messagesWrittenLast5m,
  writeFailuresLast1h, uniqueSensorsLast1h, avgWriteLatencyMs,
  brokerClientsConnected, brokerUptime
}
```

### ats-ingestion
```ts
{
  status, lastSeenAt, lastEmailCheckAt,
  emailsFoundLastRun, emailsProcessedLastRun, emailsFailedLastRun,
  sensorsUpdatedLastRun
}
```

### vibration-processor
```ts
{
  status, lastSeenAt, lastCheckAt,
  newSamplesFound, samplesProcessed, samplesFailedLastRun,
  dinAlertsCreatedLastRun
}
```

### reports-orchestrator
```ts
{
  status, lastSeenAt, lastRunAt, lastRunStatus,
  reportsGenerated, reportsDelivered, reportsFailed, durationMs
}
```

### prism-orchestrator
```ts
{
  status, lastSeenAt, lastRunAt, lastRunStatus,
  sensorsProcessed, durationMs
}
```

---

## Priority

Low — implement after all heartbeats + watchdog are deployed and running. This is the "nice to have" visibility layer. WhatsApp alerts are the primary notification mechanism.
