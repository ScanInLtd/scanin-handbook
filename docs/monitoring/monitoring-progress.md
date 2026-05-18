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
| ATS heartbeat check | ⬜ | Same pattern as bridge |
| Vibration heartbeat check | ⬜ | Same pattern as bridge |
| GCP Monitoring API (function execution/error counts) | ⬜ | |
| Daily jobs checks (reports/prism/cleanup) | ⬜ | |
| Firestore Admin API (backup recency) | ⬜ | |
| Daily summary (07:00 IST) | ⬜ | Formatter exists, needs daily tier wiring |
| Daily metrics rotation (delete >30d) | ⬜ | |
| Bridge suppression → suppress function alerts | ⬜ | |
| Deploy to Cloud Run | ⬜ | Needs env vars + service account |
| Create Cloud Scheduler jobs (5min/15min/daily) | ⬜ | |
| Canary sensor logic | ⬜ | Later |

### 2. `scanin-svc-mqtt-bridge`
**Role:** Add heartbeat writer + $SYS subscription.

| Task | Status | Notes |
|---|---|---|
| Subscribe to `$SYS/#` topics | ⬜ | |
| Rolling metrics counters (in-memory) | ⬜ | |
| Heartbeat writer (every 5 min → `system-heartbeats/mqtt-bridge`) | ⬜ | |
| Deploy to bridge VM | ⬜ | |

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
| Admin route + page scaffold | ⬜ | `/admin/monitoring` |
| Service cards (heartbeat status) | ⬜ | |
| Health checks table | ⬜ | |
| Active incidents display | ⬜ | |
| Maintenance mode indicator | ⬜ | |
| Recent resolved incidents | ⬜ | |

---

## Milestones

| Milestone | Depends on | Status |
|---|---|---|
| Bridge heartbeat visible in Firestore | Bridge deployed | ⬜ |
| Watchdog reads bridge + sends first alert | Watchdog + bridge | ⬜ |
| Daily summary working | Watchdog | ⬜ |
| All Node.js services reporting | Reports + prism | ⬜ |
| ATS + vibration reporting | C# changes | ⬜ |
| Full system monitored | All above | ⬜ |

---

## Design Docs

- [System Monitoring Design](./system-monitoring-design.md) ✅
- [Per-Component Check Specs](./monitoring-checks.md) ✅
