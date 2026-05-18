# ScanIn Observability & Operations Monitor — Design Document

## 1. System Overview

ScanIn is an IoT monitoring platform for construction/infrastructure sites. Physical sensors (crack gauges, tilt meters, vibration sensors, prism targets) send data through various paths into a central Firestore database. A web platform displays real-time and historical data. Automated systems generate reports, check thresholds, and alert stakeholders when limits are exceeded.

### Data Flow (simplified)

```
Sensors → MQTT Broker → Bridge → Firestore ← Web Platform (users)
                                     ↓
                          Functions (thresholds, alerts)
                                     ↓
                          WhatsApp / Email alerts

ATS system (Hexagon) → Email → PC scraper → Firestore
Beanair vibration sensors → PC processor (MATLAB) → Firestore

Firestore data → Scheduled jobs → Reports (PDF) → Email to clients
Firestore data → Daily prism processing → Displacement calculations
```

### What Breaks = Business Impact

| If this stops... | Users experience... | Time to notice without monitoring |
|---|---|---|
| MQTT broker or bridge | No new sensor data appears in platform | Hours (until someone checks) |
| ATS ingestion | Missing survey/crack data for sites | Days (next scheduled report fails) |
| Vibration processing | No DIN alerts for vibration events | Could miss a critical vibration event |
| Threshold functions | Alerts stop firing even when limits exceeded | Unknown — silent failure |
| Daily reports | Clients don't get their morning reports | Next business day |
| Prism daily processing | Displacement charts stop updating | Days |
| Firestore backups | No safety net for data corruption | Unknown |

---

## 2. System Components (Detailed)

### GCP Projects

| Project | Purpose |
|---|---|
| `dataloggerdev` | Main project: Firebase/Firestore DB, Cloud Run services, Functions, Hosting |
| `monitoringbridge` | Bridge VM (MQTT→Firestore ingestion) |
| `mqttbroker-442910` | Dedicated MQTT broker VM |

### Real-Time Data Pipeline (Critical Path)

**MQTT Broker** (`mqtt-broker` VM, mqttbroker-442910, e2-medium, europe-west1-d)
- Mosquitto broker on port 8883 (TLS)
- All field sensors (Photon IoT gateways, Beanair tilt sensors) connect here
- If this dies: no new data enters the system at all

**MQTT→Firestore Bridge** (`monitoring-bridge-vm`, monitoringbridge, e2-medium, europe-west1-b)
- Dockerized Node.js service subscribing to MQTT topics
- Translates sensor messages into Firestore documents (`work-sensors/{id}/data-log/{entry}`)
- Handles: Photon gateway messages, Beanair tilt sensor data, ScanIn device protocol
- Connects to broker at 34.38.96.215:8883 with TLS
- If this dies: broker buffers messages briefly, but data stops reaching Firestore

**Threshold & Alert Functions** (Firebase Functions, dataloggerdev)
- `checkThresholds` — triggered on every new data-log write; compares value to sensor thresholds
- `handleAlerts` — triggered when alert document created; sends WhatsApp + email notifications
- `evaluateMultiSensorRules` — triggered on alert create; checks multi-sensor rules
- If these fail: sensor values exceed limits but nobody is notified

### Scheduled Processing

**Daily Reports** (Cloud Run: `reports-orchestrator` + `reports-worker`)
- Triggered daily at 02:00 IST by Cloud Scheduler
- Orchestrator determines which reports to generate, dispatches to worker
- Worker generates PDF reports and emails them to site managers via SendGrid
- Business-critical: clients expect reports every morning

**Daily Prism Processing** (Cloud Run: `daily-prism-orchestrator` + `daily-prism-worker`)
- Triggered daily at 00:05 IST by Cloud Scheduler
- Calculates displacement (settlement, easting, northing) from prism sensor readings
- Stores computed results back in Firestore for the web platform to display
- If this fails: displacement charts show stale data

**~~Sensor Report Generation~~** (Firebase Function Gen2: `generateSensorReports`) — DEPRECATED
- Generates vibration sensor PDF reports hourly using Puppeteer
- Writes to `auto-report-sensors/{id}/outbox` for distribution
- Part of deprecated vibration-specific report system

**Calculated Sensors** (Cloud Run: `schedulecalcsensors` + `processcalcsensor`)
- Triggered every 30 min by Cloud Scheduler
- Processes computed/derived sensor values

**~~Report Distribution~~** (Firebase Function: `distributeReportsScheduled`) — DEPRECATED
- Part of the vibration-specific report system (not the main reports)
- Polls `auto-report-sensors/{id}/outbox` every 30 min, emails PDF links
- Works in pair with `generateSensorReports` — both to be decommissioned

**Cleanup** (Cloud Run: `cleanunconfirmedsensors`)
- Daily at 00:00 IST — removes unconfirmed/orphan sensors

### On-Premises Services (Windows PCs)

**ATS Email Ingestion** (Natan's PC)
- C# .NET service that monitors a mailbox for Hexagon ATS reports
- Opens email links with a browser (non-headless required) to download survey data
- Parses and pushes results to Firestore
- PC is unstable; service occasionally stops
- Cannot easily be moved to cloud due to browser/scraping requirements

**Vibration Processor** (Monitoring PC)
- C# .NET service processing Beanair vibration sensor data
- Requires MATLAB runtime and proprietary Beanair application
- Generates DIN 4150-3 compliance checks and vibration reports
- Cannot be moved to cloud due to MATLAB + Beanair dependencies

### Integrations

| Provider | Purpose | Used By |
|---|---|---|
| Green API | WhatsApp message sending | `handleAlerts` function — threshold & DIN alerts in Hebrew |
| SendGrid | Email delivery | Reports worker — PDF reports to clients |
| SendGrid | Email alerts | Alert distribution to stakeholders |

### Firestore Backups

- Daily automatic backups, 30-day retention
- Point-in-time recovery (PITR), 7-day window
- Latest backup: May 17, 2026 ✅

### Stopped/Deprecated

| Item | Notes |
|---|---|
| `tools-vm` (STOPPED) | GPR DXF generator, unused ~10 months |
| `ats-email-handler` VM (TERMINATED) | Failed attempt to run ATS in cloud |
| `oldwindowsbridge` VM (TERMINATED) | Legacy Windows bridge |
| HiveMQ container on bridge VM (STOPPED) | Orphaned; bridge connects to mqtt-broker VM directly |
| `nightly-reports-trigger` scheduler job | Dead — targets non-existent `scanin-orchestrator` |
| `orchestrator-pipeline-check` scheduler job | Dead — targets non-existent `scanin-orchestrator` |
| `generateSensorReports` function | Deprecated vibration report generator (hourly) |
| `distributeReportsScheduled` function | Deprecated vibration report distributor (30-min poll) |
| `runVibrationReportNow` function | Deprecated on-demand vibration report |
| `generateSensorReports` scheduler job | Triggers deprecated function |
| `distributeReportsScheduled` scheduler job | Triggers deprecated function |

---

## 3. Existing Health Endpoints

| Service | Endpoint | What it checks |
|---|---|---|
| `reports-worker` | `GET /health` | Service responsive |
| `daily-prism-worker` | `GET /health` | Service responsive |
| `daily-prism-orchestrator` | `GET /health` | Service responsive |
| `reports-orchestrator` | `GET /` | Status/info page |
| Bridge Docker container | `node -e process.exit(0)` | Node.js process alive (weak) |

These only confirm the process is running — they don't confirm business logic is working.

---

## 4. Cleanup Tasks (Pre-Monitoring)

- [ ] Delete orphaned scheduler jobs: `nightly-reports-trigger`, `orchestrator-pipeline-check`
- [ ] Decommission deprecated vibration report functions: `generateSensorReports`, `distributeReportsScheduled`, `runVibrationReportNow`
- [ ] Remove HiveMQ container from bridge VM (currently stopped)
- [ ] Rotate MQTT credentials (exposed in container env)

---

## 5. Observability Architecture

### Three Layers

| Layer | Question | Examples |
|---|---|---|
| **Health** | Is it working now? | Bridge writing, ATS checking emails, reports completed, backups exist |
| **Load / Throughput** | How busy is it? | Messages/hour, reports/day, write latency, error count |
| **Anomaly** | Is this pattern unusual? | Sensor sending 5 readings instead of 60, report taking 45 min instead of 8 |

### Two Data Sources

**Self-reporting heartbeats** — services write to `system-heartbeats/{serviceName}`:
- Bridge (every 5 min): message counts, latency, MQTT connection state, broker $SYS stats
- ATS ingestion (each cycle): emails checked/found/processed/failed
- Vibration processor (each cycle): samples found/processed, DIN alerts created
- Report/prism orchestrators (after each run): status, counts, duration

**External watchdog** (Cloud Run, triggered by Scheduler):
- Reads heartbeat docs (staleness = failure)
- GCP Cloud Monitoring API: function execution counts + error rates
- GCP Compute API: VM status
- Firestore Admin API: backup recency
- Compares against thresholds, manages incidents, sends alerts

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│             SERVICES (self-report)                       │
├─────────────────────────────────────────────────────────┤
│  Bridge ──→ system-heartbeats/mqtt-bridge      (5 min)  │
│  ATS ──→ system-heartbeats/ats-ingestion    (each cycle)│
│  Vibration ──→ system-heartbeats/vibration-processor    │
│  Reports ──→ system-heartbeats/reports-orchestrator     │
│  Prism ──→ system-heartbeats/prism-orchestrator         │
└────────────────────────┬────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  Cloud Scheduler (5min / 15min / daily)                 │
│         ↓                                               │
│  Cloud Run "watchdog"                                   │
│    • reads heartbeat docs                               │
│    • queries GCP Monitoring API (functions)             │
│    • queries Compute API (VM status)                    │
│    • queries Firestore Admin API (backups)              │
└────────────────────────┬────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│               FIRESTORE STATE                           │
├─────────────────────────────────────────────────────────┤
│  system-checks/{checkId}           — latest per check   │
│  system-incidents/{id}             — open incidents      │
│  system-metrics/{component}/daily/{date} — daily stats   │
│  system-maintenance/{component}    — suppress alerts     │
└────────────────────────┬────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│               OUTPUTS                                   │
├─────────────────────────────────────────────────────────┤
│  WhatsApp alerts (Green API) — critical/recovery         │
│  Daily summary — "all OK" or "N issues"                  │
│  Admin dashboard (future) — health + trends              │
└─────────────────────────────────────────────────────────┘
```

### Firestore Storage (bounded, rotated)

| Collection | Docs | Growth |
|---|---|---|
| `system-heartbeats/{service}` | 5 | Fixed (overwritten) |
| `system-checks/{checkId}` | ~10 | Fixed (overwritten) |
| `system-incidents/{id}` | 0–5 | Only during failures |
| `system-metrics/{component}/daily/{date}` | ~300 max | Rotated: >30 days deleted |
| `system-maintenance/{component}` | 0–2 | Manual |

**Total: ~320 docs, ~60K writes/month.** Free tier territory.

### Check Schedule

| Tier | Interval | Checks |
|---|---|---|
| **Critical** | Every 5 min | Bridge heartbeat staleness, broker stats |
| **High** | Every 15 min | ATS heartbeat, vibration heartbeat, function errors |
| **Daily** | 07:00 IST | Reports ran, prism ran, backups, cleanup, summary |

### Alerting Rules (Deduplicated)

| Event | Action |
|---|---|
| First critical/high failure | WhatsApp alert immediately |
| Still failing after 30 min | Reminder |
| Still failing after 2 hours | Escalation reminder |
| Recovery | "Resolved" message |
| Daily 07:00 IST | Summary: "All OK" or "N open issues" |

No alert spam. State tracked in Firestore. Maintenance mode suppresses alerts.

---

## 6. Implementation Plan

All done together (no phased split):

### Code Changes to Existing Services

| Service | Change | Effort |
|---|---|---|
| **Bridge** (Node.js) | Subscribe to `$SYS/#`, add heartbeat writer (every 5 min) | ~30 lines |
| **ATS Ingestion** (C#) | Add Firestore heartbeat write after each email check cycle | ~20 lines |
| **Vibration Processor** (C#) | Add Firestore heartbeat write after each processing cycle | ~20 lines |
| **Reports Orchestrator** (Node.js) | Add heartbeat write at end of run | ~5 lines |
| **Prism Orchestrator** (Node.js) | Add heartbeat write at end of run | ~5 lines |

### New Service

| Component | What |
|---|---|
| **Watchdog** (Cloud Run, Node.js) | Reads heartbeats + GCP APIs, evaluates thresholds, manages incidents, sends WhatsApp alerts |
| **Cloud Scheduler jobs** | 3 jobs triggering watchdog at 5min / 15min / daily intervals |

---

## 7. Remaining Questions

### Alerting

1. **Who receives monitoring alerts?** Just you, or also a team/group?
2. **WhatsApp channel** — same Green API instance as threshold alerts, or separate?
3. **Daily summary time** — 07:00 IST good?

### Auto-Recovery (Future)

4. **Should the monitor attempt restarts?** E.g., restart bridge Docker container if no writes in 15 min?
5. **Re-trigger failed daily jobs** — if prism/reports didn't run, should monitor re-invoke?
6. **PC services** — any remote restart capability, or alert-only?

### Cleanup

7. **When to decommission vibration report functions?** `generateSensorReports` + `distributeReportsScheduled` + `runVibrationReportNow` are deprecated.
