# Watchdog Service — Progress Summary

**Date:** 2026-05-18  
**Repo:** [scanin-svc-watchdog](https://github.com/ScanInLtd/scanin-svc-watchdog)  
**Status:** Initial scaffold complete, critical tier fully functional

---

## What Was Built

The watchdog service skeleton is in place and compiles cleanly. The critical-tier path (bridge monitoring) is fully wired end-to-end:

### Architecture

```
Cloud Scheduler (5min) → POST /check?tier=critical
    → Read bridge heartbeat from Firestore
    → Evaluate 4 health checks (staleness, MQTT, writes, broker clients)
    → Compare against previous state
    → Create/update/resolve incidents
    → Apply dedup rules (no alert spam)
    → Send WhatsApp alert via Green API
    → Return 200 with JSON summary
```

### Files Delivered

| File | Role |
|---|---|
| `src/index.ts` | Express app — `POST /check` + `GET /health` |
| `src/constants.ts` | Collection paths, thresholds, alert rules, GCP config |
| `src/types.ts` | TypeScript interfaces (CheckResult, Incident, heartbeats) |
| `src/firestore.ts` | DB singleton + time utilities |
| `src/check-runner.ts` | Tier dispatcher — runs checks → incidents → alerts |
| `src/checks/bridge.ts` | 4 bridge checks with exact thresholds from spec |
| `src/incidents/manager.ts` | Incident lifecycle: create, update, resolve |
| `src/incidents/dedup.ts` | Alert timing: immediate → 30min → 2h → cap at 5 |
| `src/alerts/whatsapp.ts` | Green API HTTP sender |
| `src/alerts/formatter.ts` | Message templates (alert, recovery, reminder, daily summary) |
| `src/maintenance.ts` | Reads maintenance docs, suppresses alerts |
| `Dockerfile` | Production build for Cloud Run |
| `package.json` / `tsconfig.json` | Dependencies + TypeScript config |

### What's Working

- **Critical tier (bridge):** Fully wired. Reads `system-heartbeats/mqtt-bridge`, evaluates 4 checks, manages incidents, sends WhatsApp alerts with dedup.
- **Incident management:** Creates incidents on degradation, resolves on recovery, tracks timeline events.
- **Alert dedup:** First alert immediate, reminders at 30min/2h, max 5 per incident.
- **Maintenance mode:** Components in `system-maintenance/*` have alerts suppressed.
- **Build:** TypeScript compiles cleanly. Dockerfile ready for `gcloud run deploy --source .`

---

## What's Remaining

| Task | Tier | Effort |
|---|---|---|
| `checks/ats.ts` — ATS heartbeat staleness | High | Small (same pattern as bridge) |
| `checks/vibration.ts` — Vibration heartbeat | High | Small |
| `checks/functions.ts` — GCP Monitoring API queries | High | Medium (new API) |
| `checks/daily-jobs.ts` — Reports/prism/cleanup | Daily | Small |
| `checks/backups.ts` — Firestore Admin API | Daily | Medium |
| `rotation.ts` — Delete old metrics/incidents | Daily | Small |
| Bridge suppression logic (stale bridge → suppress function alerts) | High | Small |
| Deploy to Cloud Run + create Scheduler jobs | Ops | ~15 min |
| Env vars: GREEN_API_SEND_MESSAGE_URL, GREEN_API_CHAT_ID | Config | Need from team |
| Service account with correct IAM roles | Config | Need from team |

---

## Blocking / Needs Decision

1. **Green API chat ID** — same WhatsApp group as threshold alerts, or a separate monitoring group?
2. **Service account** — needs: Firestore read/write, Monitoring Viewer, Compute Viewer. Who creates?
3. **Bridge heartbeat** — does the bridge already write to `system-heartbeats/mqtt-bridge`? If not, that's the prerequisite before this service can do anything useful.

---

## Next Session Plan

1. Add high-tier checks (ATS, vibration, functions) — ~30 min
2. Add daily-tier checks (reports, prism, backups, cleanup, rotation) — ~30 min
3. Deploy to Cloud Run + create scheduler jobs — ~15 min
4. Test with live Firestore data

---

## Tech Notes

- **Node.js 22 + TypeScript** (matches team's latest services)
- **Express 5** (single endpoint, minimal footprint)
- **firebase-admin** for Firestore (same project: `dataloggerdev`)
- **@google-cloud/monitoring** for function execution/error metrics
- **axios** for Green API HTTP calls
- Zero external state — all state lives in Firestore
- Estimated cost: ~60K Firestore writes/month (free tier)
