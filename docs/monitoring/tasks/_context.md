# Monitoring System — Context (copy into each repo's task doc)

## System Overview

ScanIn is an IoT monitoring platform for construction/infrastructure sites. Sensors send data through MQTT → Bridge → Firestore. A web platform displays data. Automated functions check thresholds and send alerts (WhatsApp, email). Scheduled jobs generate daily reports and process displacement calculations.

## Monitoring Architecture

All services self-report heartbeats to a shared Firestore collection. A Cloud Run watchdog reads these heartbeats + GCP APIs, evaluates health, and sends alerts.

```
Services → system-heartbeats/{serviceName}  (Firestore, overwritten)
                     ↓
Cloud Scheduler → Watchdog (Cloud Run)
                     ↓
           Alerts (WhatsApp) + Incidents (Firestore)
```

## Firestore Collections (monitoring)

| Collection | Purpose |
|---|---|
| `system-heartbeats/{service}` | Each service overwrites its heartbeat doc |
| `system-health/checks/{checkId}` | Watchdog writes latest check result |
| `system-health/incidents/{id}` | Open incidents (auto-closed on recovery) |
| `system-metrics/{component}/daily/{date}` | Daily snapshots, rotated after 30 days |
| `system-maintenance/{component}` | Suppress alerts during planned work |

## Heartbeat Rules

- Include `schemaVersion: 1` in every heartbeat
- Use `FieldValue.serverTimestamp()` for `lastSeenAt` — never local clock
- Heartbeat write failures must NOT crash the main service (try/catch, log, continue)
- One doc per service, overwritten in place — no history, no accumulation

## Services That Report Heartbeats

| Service | Doc ID | Frequency |
|---|---|---|
| MQTT Bridge (Node.js) | `mqtt-bridge` | Every 5 min |
| ATS Ingestion (C#) | `ats-ingestion` | Each email check cycle |
| Vibration Processor (C#) | `vibration-processor` | Each processing cycle |
| Reports Orchestrator (Node.js) | `reports-orchestrator` | After each daily run |
| Daily Prism Calc (Node.js) | `daily-prism-calc` | After each daily run |

## Full Design Docs

- [System Monitoring Design](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/system-monitoring-design.md)
- [Per-Component Check Specs](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/monitoring-checks.md)
- [Progress Tracker](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/monitoring-progress.md)

Local path (if repos cloned side by side): `../scanin-handbook/docs/monitoring/`
