# Monitoring Implementation — Progress Tracker

## Status Legend
- ⬜ Not started
- 🟡 In progress
- ✅ Done

---

## Repos & Tasks

### 1. `scanin-svc-watchdog` (NEW REPO)
**Role:** Cloud Run watchdog — reads heartbeats, queries GCP APIs, manages incidents, sends alerts.

| Task | Status | Notes |
|---|---|---|
| Create repo + project scaffold | ✅ | Express + TS + Dockerfile |
| Firestore constants (collection paths, schema) | ✅ | `src/constants.ts` |
| Read heartbeat docs + evaluate staleness (bridge) | ✅ | `src/checks/bridge.ts` — 4 checks |
| Incident management (create/update/resolve) | ✅ | `src/incidents/manager.ts` |
| Alert dedup logic | ✅ | `src/incidents/dedup.ts` |
| Maintenance mode check | ✅ | `src/maintenance.ts` |
| WhatsApp alert output (Green API) | ✅ | `src/alerts/whatsapp.ts` + `formatter.ts` |
| ATS heartbeat check | ✅ | `checks/ats.ts` — warn > 2h, critical > 6h |
| Vibration heartbeat check | ✅ | `checks/vibration.ts` — warn > 30min, critical > 2h |
| GCP Monitoring API (function execution/error counts) | ✅ | `checks/functions.ts` + writes to `system-heartbeats/firebase-functions` |
| Daily jobs checks (reports/prism/cleanup) | ✅ | `checks/daily-jobs.ts` |
| Firestore Admin API (backup recency) | ✅ | `checks/backups.ts` — warn > 25h, critical > 48h |
| Daily summary (07:00 IST) | ✅ | Wired in check-runner |
| Daily metrics rotation (delete >30d) | ✅ | `rotation.ts` + incidents > 90d |
| Bridge suppression → suppress function alerts | ✅ | Stale bridge suppresses zero-exec warnings |
| Deploy to Cloud Run | ⬜ | Needs env vars + service account |
| Create Cloud Scheduler jobs (5min/15min/daily) | ⬜ | |
| GCP Compute API (bridge VM status) | ⬜ | Optional |
| Canary sensor logic | ⬜ | Later |

### 2. `scanin-svc-mqtt-bridge`
**Role:** Add heartbeat writer + $SYS subscription.

| Task | Status | Notes |
|---|---|---|
| Subscribe to `$SYS/#` topics | ✅ | In `mqttService.js` |
| Rolling metrics counters (in-memory) | ✅ | 5-min + 1-hour resets |
| Heartbeat writer (every 5 min → `system-heartbeats/mqtt-bridge`) | ✅ | `heartbeatService.js`, server timestamps, try/catch |
| Deploy to bridge VM | ✅ | Deployed 2026-05-19 |

### 3. `scanin-svc-reports`
**Role:** Add heartbeat at end of orchestrator run.

| Task | Status | Notes |
|---|---|---|
| Heartbeat write after orchestrator completes | ⬜ | ~5 lines |
| Deploy | ⬜ | |

### 4. `scanin-worker-prism-daily`
**Role:** Add heartbeat at end of orchestrator run.

| Task | Status | Notes |
|---|---|---|
| Heartbeat write after orchestrator completes | ⬜ | ~5 lines |
| Deploy | ⬜ | |

### 5. ATS Ingestion (C#)
**Role:** Add Firestore heartbeat write after each email check cycle.

| Task | Status | Notes |
|---|---|---|
| Add Firestore SDK / connection | ⬜ | May already exist |
| Heartbeat write after each cycle | ⬜ | ~20 lines |
| Deploy | ⬜ | |

### 6. Vibration Processor (C#)
**Role:** Add Firestore heartbeat write after each processing cycle.

| Task | Status | Notes |
|---|---|---|
| Add Firestore SDK / connection | ⬜ | May already exist |
| Heartbeat write after each cycle | ⬜ | ~20 lines |
| Deploy | ⬜ | |

### 7. Web App (admin page)
**Role:** Admin-only monitoring dashboard — read-only view of heartbeats, checks, incidents.

| Task | Status | Notes |
|---|---|---|
| Admin route + page scaffold | ✅ | `/settings/system-monitoring` |
| Service cards (heartbeat status) | ✅ | Color coded, staleness thresholds |
| Health checks table | ✅ | Real-time Firestore listeners |
| Active incidents display | ✅ | |
| Maintenance mode indicator | ✅ | Banner |
| Recent resolved incidents | ✅ | Expandable, last 10 |
| Webapp usage metrics | ⬜ | Deferred, low priority |
| ⚠️ Verify Firestore paths match watchdog | ✅ | Fixed to root collections |

---

## Milestones

| Milestone | Depends on | Status |
|---|---|---|
| Bridge heartbeat visible in Firestore | Bridge deployed | ✅ |
| Watchdog reads bridge + sends first alert | Watchdog + bridge | ⬜ |
| Daily summary working | Watchdog | ⬜ |
| All Node.js services reporting | Reports + prism | ⬜ |
| ATS + vibration reporting | C# changes | ⬜ |
| Full system monitored | All above | ⬜ |

---

## Deployments

| Service | Deployed? | Version | Date | Where |
|---|---|---|---|---|
| `scanin-svc-watchdog` | ⬜ No | — | — | Cloud Run (dataloggerdev, us-central1) |
| `scanin-svc-mqtt-bridge` (heartbeat) | ✅ Yes | 1.0.0 | 2026-05-19 | monitoring-bridge-vm (`./deploy.sh`) |
| `scanin-svc-reports` (heartbeat) | ⬜ No | — | — | Cloud Run (dataloggerdev) |
| `scanin-worker-prism-daily` (heartbeat) | ⬜ No | — | — | Cloud Run (dataloggerdev) |
| ATS Ingestion (heartbeat) | ⬜ No | — | — | Natan's PC |
| Vibration Processor (heartbeat) | ⬜ No | — | — | Monitoring PC |

---

## Design Docs

- [System Monitoring Design](./system-monitoring-design.md) ✅
- [Per-Component Check Specs](./monitoring-checks.md) ✅
