# Monitoring Checks — Per-Component Specification

## General Principles

### Consistent Check Structure

Every monitored component follows the same pattern:

```ts
{
  checkId: string,              // unique, snake_case: "bridge_data_freshness"
  component: string,            // logical group: "mqtt-bridge", "daily-reports"
  status: "ok" | "warning" | "critical",
  message: string,              // human-readable: "Bridge last wrote 3 min ago"
  observedAt: Timestamp,        // when this check ran
  lastHealthyAt: Timestamp,     // last time status was "ok"
  severity: "critical" | "high" | "medium",
  confidence: "high" | "medium" | "low",
  dedupeKey: string             // for alert grouping: "bridge_down"
}
```

### Consistent Alerting Behavior

| Rule | Behavior |
|---|---|
| First failure (critical) | WhatsApp immediately |
| First failure (high) | WhatsApp immediately |
| First failure (medium) | Include in daily summary only |
| Still failing after 30 min | Reminder |
| Still failing after 2 hours | Escalation reminder |
| Recovery | "Resolved" message |
| Daily 07:00 IST | Summary of all checks |

### Expected Silence Rules

Not all silence is failure. Each check defines when silence is acceptable:

```ts
{
  expectedCadence: "5m" | "1h" | "daily" | "irregular",
  businessHoursOnly: boolean,       // suppress outside Sun-Thu 07:00-18:00 IST
  activeDays: ["sun","mon","tue","wed","thu"],
}
```

Examples:
- **Bridge** — cadence `"1h"` (Beanair hourly), active always
- **ATS** — cadence `"daily"`, business hours only
- **Vibration** — cadence `"irregular"`, depends on construction activity
- **Daily reports** — cadence `"daily"`, check only in morning

### Confidence Level

Each check reports how certain the diagnosis is:

```ts
confidence: "high" | "medium" | "low"
```

| Signal | Confidence |
|---|---|
| VM not running | High |
| Port unreachable | High |
| No bridge data for 2h | High (Beanair sends hourly) |
| No ATS data by 10:00 | Medium (maybe no surveys today) |
| No vibration data for 6h | Low (maybe no construction) |
| Function error spike | Medium |

Higher confidence → alert sooner. Lower confidence → wider thresholds, softer alerts.

### Maintenance Mode

Suppress alerts during planned work:

```
system-maintenance/{component}
{
  enabled: true,
  until: Timestamp,
  reason: "rotating MQTT credentials",
  suppressAlerts: true
}
```

Watchdog checks maintenance state before alerting. Expired maintenance auto-clears.

### Incident Timeline

Each incident tracks an event log:

```
system-health/incidents/{id}/events/{timestamp}
{
  type: "warning" | "critical" | "alert_sent" | "reminder" | "recovered",
  message: string,
  channel: "whatsapp" | "email" | null
}
```

Example:
```
10:05  warning    — "Bridge data stale (12 min)"
10:20  critical   — "Bridge data stale (27 min)"
10:21  alert_sent — WhatsApp sent
10:50  reminder   — "Still failing (57 min)"
11:02  recovered  — "Bridge writing again"
11:02  alert_sent — "Resolved" WhatsApp sent
```

### Consistent Freshness Check Pattern

For any component that produces data on a schedule, the check is:

```
latest_timestamp = query Firestore for most recent output
staleness = now - latest_timestamp
if staleness > critical_threshold → critical
if staleness > warning_threshold → warning
else → ok
```

### Check Tiers

| Tier | Interval | Applies to |
|---|---|---|
| **Critical (5 min)** | Every 5 min | Real-time data pipeline |
| **High (15 min)** | Every 15 min | Supporting services |
| **Daily (07:00)** | Once per day | Batch jobs, backups, summary |

---

## Component Checks

### Core Pattern

Every service writes its own heartbeat to `system-heartbeats/{serviceName}`.
The watchdog reads these docs + GCP APIs. No cross-collection queries on sensor data.

**Rules:**
- Every heartbeat includes `schemaVersion: 1` (for future-proof changes)
- Use Firestore server timestamps (`FieldValue.serverTimestamp()`) — never trust local PC clocks
- Heartbeat write failures must never crash the main service (try/catch, log, continue)

---

### 1. MQTT Broker + Bridge (monitored together)

**What:** Mosquitto broker (34.38.96.215:8883) + Docker bridge on `monitoring-bridge-vm`.
**Why critical:** The entire real-time data pipeline. If either dies, no sensor data reaches Firestore.
**Tier:** Critical (5 min)

**How monitored:**

The bridge subscribes to `$SYS/#` topics on the broker (Mosquitto built-in stats) and includes broker metrics in its own heartbeat.

**Bridge writes to:** `system-heartbeats/mqtt-bridge`

```ts
{
  schemaVersion: 1,
  serviceName: "mqtt-bridge",
  lastSeenAt: ServerTimestamp,
  version: "1.2.3",
  host: "monitoring-bridge-vm",
  status: "healthy",

  // Bridge metrics (rolling windows in memory)
  connectedToMqtt: true,
  messagesReceivedLast5m: 12,
  messagesWrittenLast5m: 11,
  writeFailuresLast1h: 0,
  uniqueSensorsLast1h: 8,
  avgWriteLatencyMs: 34,
  mqttReconnectsLast1h: 0,
  lastMessageAt: Timestamp,
  lastFirestoreWriteAt: Timestamp,

  // Broker metrics (from $SYS topics)
  brokerClientsConnected: 14,
  brokerMessagesReceivedTotal: 482910,
  brokerUptime: 1209600
}
```

**Watchdog checks:**

| Check | Source | Warning | Critical |
|---|---|---|---|
| Heartbeat fresh | `lastSeenAt` age | > 7 min | > 15 min |
| Connected to MQTT | `connectedToMqtt` | — | false |
| Writing to Firestore | `lastFirestoreWriteAt` age | > 1h | > 2h |
| Broker clients | `brokerClientsConnected` | < 3 | 0 |
| VM running | GCP Compute API | — | status != RUNNING |

**Confidence:** High (heartbeat is direct self-report).

---

### 2. ATS Email Ingestion

**What:** C# service on Natan's PC that scrapes Hexagon emails and pushes survey data to Firestore.
**Why critical:** Provides prism/settlement data for multiple sites.
**Tier:** High (15 min)

**Service writes to:** `system-heartbeats/ats-ingestion`

```ts
{
  schemaVersion: 1,
  serviceName: "ats-ingestion",
  lastSeenAt: ServerTimestamp,    // Firestore server timestamp
  version: "...",
  host: "natans-pc",
  status: "healthy" | "warning" | "error",

  lastEmailCheckAt: Timestamp,   // last time it checked for emails
  emailsFoundLastRun: 3,         // how many new emails found
  emailsProcessedLastRun: 3,     // how many successfully parsed
  emailsFailedLastRun: 0,        // how many failed to process
  lastInsertionAt: Timestamp,    // last successful write to Firestore
  sensorsUpdatedLastRun: 12      // how many sensors got new data
}
```

**Watchdog checks:**

| Check | Source | Warning | Critical |
|---|---|---|---|
| Heartbeat fresh | `lastSeenAt` age | > 2h | > 6h |
| Service checking | `lastEmailCheckAt` age | > 2h | > 6h |
| Processing errors | `emailsFailedLastRun` | > 0 | > 3 consecutive |

**Confidence:** High (direct self-report). Alerts anytime (no business hours restriction).

**Code change needed:** Add Firestore heartbeat write to C# service after each email check cycle.

---

### 3. Vibration Processor

**What:** C# service on Monitoring PC processing Beanair vibration events through MATLAB.
**Why important:** Generates DIN 4150-3 compliance alerts.
**Tier:** High (15 min)

**Service writes to:** `system-heartbeats/vibration-processor`

```ts
{
  schemaVersion: 1,
  serviceName: "vibration-processor",
  lastSeenAt: ServerTimestamp,     // Firestore server timestamp
  version: "...",
  host: "monitoring-pc",
  status: "healthy" | "warning" | "error",

  lastCheckAt: Timestamp,         // last time it checked for new samples
  newSamplesFound: 5,             // new raw samples found this cycle
  samplesProcessed: 5,            // successfully processed
  samplesFailedLastRun: 0,        // failed to process
  dinAlertsCreatedLastRun: 1,     // DIN threshold violations detected
  lastProcessedAt: Timestamp      // last successful processing
}
```

**Watchdog checks:**

| Check | Source | Warning | Critical |
|---|---|---|---|
| Heartbeat fresh | `lastSeenAt` age | > 30 min | > 2h |
| Service checking | `lastCheckAt` age | > 30 min | > 2h |
| Processing errors | `samplesFailedLastRun` | > 0 | > 3 consecutive |

**Confidence:** Medium for staleness (irregular data depends on construction activity).

**Code change needed:** Add Firestore heartbeat write to C# service after each processing cycle.

---

### 4. Threshold & Alert Functions

**What:** `checkThresholds` + `handleAlerts` + `evaluateMultiSensorRules` — real-time alerting pipeline.
**Why critical:** Silent failure means limits exceeded but nobody notified.
**Tier:** High (15 min)

**How monitored:** GCP Cloud Monitoring API (free, no Firestore writes needed).

**Watchdog queries:**

| Metric | API | Warning | Critical |
|---|---|---|---|
| Execution count (1h) | `cloudfunctions.googleapis.com/function/execution_count` | 0 runs (while bridge is healthy) | — |
| Error count (1h) | `cloudfunctions.googleapis.com/function/error_count` | error rate > 5% | error rate > 25% |
| Latency (p95) | `cloudfunctions.googleapis.com/function/execution_times` | > 10s | > 30s |

**Notes:**
- If bridge heartbeat is stale, suppress function alerts (no data → no triggers → expected).
- Future: canary sensor verifies end-to-end pipeline.

---

### 5. Daily Reports

**What:** `reports-orchestrator` + `reports-worker` — PDF reports to clients.
**Trigger:** Cloud Scheduler daily at 02:00 IST.
**Why important:** Clients expect reports every morning.
**Tier:** Daily (check at 07:00 IST)

**Orchestrator writes to:** `system-heartbeats/reports-orchestrator`

```ts
{
  serviceName: "reports-orchestrator",
  lastSeenAt: Timestamp,
  lastRunAt: Timestamp,
  lastRunStatus: "success" | "partial" | "error",
  reportsGenerated: 8,
  reportsDelivered: 8,
  reportsFailed: 0,
  durationMs: 45000
}
```

**Watchdog checks:**

| Check | Source | Warning | Critical |
|---|---|---|---|
| Ran today | `lastRunAt` is today | — | no run today by 07:00 |
| Completed OK | `lastRunStatus` | "partial" | "error" |

**Code change needed:** Add heartbeat write at end of orchestrator run (~3 lines).

---

### 6. Daily Prism Processing

**What:** `daily-prism-orchestrator` + `daily-prism-worker` — displacement calculations.
**Trigger:** Cloud Scheduler daily at 00:05 IST.
**Tier:** Daily (check at 07:00 IST)

**Orchestrator writes to:** `system-heartbeats/daily-prism-calc`

```ts
{
  serviceName: "daily-prism-calc",
  lastSeenAt: Timestamp,
  lastRunAt: Timestamp,
  lastRunStatus: "success" | "partial" | "error",
  sensorsProcessed: 24,
  durationMs: 120000
}
```

**Watchdog checks:** Same pattern as daily reports.

**Code change needed:** Add heartbeat write at end of orchestrator run.

---

### 7. Calculated Sensors

**What:** `scheduleCalcSensors` + `processCalcSensor` — derived sensor values.
**Trigger:** Cloud Scheduler every 30 min.
**Tier:** Medium (check every 15 min)

**How monitored:** GCP Cloud Monitoring API (execution count + errors for `scheduleCalcSensors`).

| Check | Source | Warning | Critical |
|---|---|---|---|
| Recent execution | Cloud Monitoring execution_count | > 45 min since last | > 90 min since last |
| Errors | Cloud Monitoring error_count | > 0 in last run | all runs failing |

---

### 8. Firestore Backups

**What:** Daily automatic backups, 30-day retention, 7-day PITR.
**Tier:** Daily (check at 07:00 IST)

**How monitored:** Firestore Admin API.

| Check | Source | Warning | Critical |
|---|---|---|---|
| Backup recency | `gcloud firestore backups list` | latest > 25h | latest > 48h |

---

### 9. Cleanup Function

**What:** `cleanUnconfirmedSensors` — daily housekeeping.
**Trigger:** Daily at 00:00 IST.
**Tier:** Daily, medium severity.

**How monitored:** GCP Cloud Monitoring API (execution count for `cleanUnconfirmedSensors`).

| Check | Source | Warning | Critical |
|---|---|---|---|
| Ran today | Cloud Monitoring execution_count | didn't run today | didn't run 3+ days |

---

## Summary Table

| # | Component | Tier | Primary Signal | Method | Severity |
|---|---|---|---|---|---|
| 1 | Broker + Bridge | 5 min | Heartbeat doc | Self-reported to Firestore | 🔴 Critical |
| 2 | ATS Ingestion | 15 min | Heartbeat doc | Self-reported to Firestore | 🔴 Critical |
| 3 | Vibration Processor | 15 min | Heartbeat doc | Self-reported to Firestore | 🟠 High |
| 4 | Alert Functions | 15 min | Execution/error count | GCP Monitoring API | 🟠 High |
| 5 | Daily Reports | Daily | Heartbeat doc | Self-reported to Firestore | 🟠 High |
| 6 | Daily Prism | Daily | Heartbeat doc | Self-reported to Firestore | 🟠 High |
| 7 | Calculated Sensors | 15 min | Execution count | GCP Monitoring API | 🟡 Medium |
| 8 | Firestore Backups | Daily | Backup list | Firestore Admin API | 🟡 Medium |
| 9 | Cleanup | Daily | Execution count | GCP Monitoring API | 🟡 Medium |

---

## Not Monitored (Deprecated)

- `generateSensorReports` — deprecated vibration report generator
- `distributeReportsScheduled` — deprecated vibration report distributor
- `runVibrationReportNow` — deprecated on-demand vibration report
- `tools-vm` — stopped, unused
- HiveMQ container — stopped, orphaned

---

## Canary Sensor (Alert Pipeline Verification)

Create one synthetic sensor that periodically writes a test value crossing a threshold.

Expected chain:
```
canary data-log write → checkThresholds fires → alert doc created → handleAlerts fires → delivery marked as test (not sent to users)
```

If the canary alert doesn't appear within expected time, the alert pipeline is broken.

| Check | Method | Critical |
|---|---|---|
| Canary completed | Expected alert doc exists within 5 min of canary write | canary alert missing after 10 min |

**Implementation:**
- Watchdog writes a canary data-log entry every hour
- `checkThresholds` processes it normally but recognizes canary sensor → creates alert doc marked `isCanary: true`
- `handleAlerts` sees `isCanary: true` → logs success but skips actual delivery
- Watchdog checks for canary alert doc on next run

---

## Firestore Storage Model

### Principle: Overwrite, Don't Accumulate

No unbounded growth. Current state is overwritten in place. History is capped and rotated.

### Collections

| Collection | Doc count | Growth | Writes/month |
|---|---|---|---|
| `system-heartbeats/{service}` | ~5 (one per service) | Fixed | ~8,640 per service |
| `system-checks/{checkId}` | ~10 | Fixed (overwritten) | ~50K total |
| `system-incidents/{id}` | 0–5 (active only) | Only during failures | Near zero normally |
| `system-incidents/{id}/events/{ts}` | 5–10 per incident | Auto-pruned on resolve | Near zero |
| `system-metrics/{component}/daily/{YYYY-MM-DD}` | ~300 max (10 components × 30 days) | Rotated: >30 days deleted | ~10/day |
| `system-maintenance/{component}` | 0–2 | Manual, rare | Near zero |

**Total steady-state: ~320 documents. ~60K writes/month.** Essentially free tier.

### Heartbeat Documents (one per service, overwritten)

```
system-heartbeats/mqtt-bridge           ← Bridge writes every 5 min (includes broker $SYS stats)
system-heartbeats/ats-ingestion         ← ATS C# writes after each email check cycle
system-heartbeats/vibration-processor   ← Vibration C# writes after each processing cycle
system-heartbeats/reports-orchestrator  ← Reports writes at end of each daily run
system-heartbeats/daily-prism-calc      ← Prism writes at end of each daily run
```

Each doc is overwritten in place. See Component Checks section for exact fields per service.

### Daily Metrics Snapshot (one doc per component per day)

```ts
// system-metrics/mqtt-bridge/daily/2026-05-18
{
  component: "mqtt-bridge",
  date: "2026-05-18",
  totalMessages: 3420,
  totalWriteFailures: 4,
  uniqueSensors: 47,
  uniqueSites: 6,
  peakMessagesPerHour: 210,
  uptimeMinutes: 1440
}
```

Written once at end of day (or by watchdog daily run). Rotated: watchdog deletes docs older than 30 days.

### Rotation

Watchdog daily run (07:00 IST) also:
1. Deletes `system-metrics/*/daily/*` docs older than 30 days
2. Deletes resolved incidents older than 90 days

---

## Future Additions

### Backlog Tracking

For each pipeline, track pending work:

| Pipeline | Backlog signal |
|---|---|
| Alert delivery | alerts created but not delivered |
| Report generation | reports scheduled but not generated |
| Bridge | MQTT messages received but not written (from self-reported metrics) |

Growing backlog = earliest overload signal.

### Dominance Anomaly

Detect when one sensor/site dominates traffic:

```json
{
  "topSensorsLast1h": [{"sensorId": "...", "messages": 4200}],
  "topSitesLast1h": [{"siteId": "...", "messages": 5100}]
}
```

Flag if any single source > 70% of total traffic — may indicate noisy sensor, firmware loop, or physical event.

### Runbook Keys

Each check links to resolution steps:

```ts
runbookKey: "restart_mqtt_bridge"
```

Admin UI shows:
> **Problem:** bridge stale
> **Actions:** 1. Check VM status → 2. SSH + docker logs → 3. docker restart → 4. Verify Firestore writes
