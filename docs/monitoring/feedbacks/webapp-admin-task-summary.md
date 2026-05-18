# System Monitoring Admin Page — Implementation Summary

**Date:** 2026-05-19  
**Route:** `/settings/system-monitoring`  
**Access:** Admin-only (via Settings Dashboard card)

---

## What Was Built

A read-only System Health Monitor page that displays backend service status at a glance. Accessible from the Settings dashboard as "System Monitoring" (index 15).

### Sections Implemented

| # | Section | Data Source | Status |
|---|---------|-------------|--------|
| 1 | Service Cards (grid) | `system-heartbeats/{service}` | ✅ Done |
| 2 | Health Checks Table | `system-health/checks/items/{checkId}` | ✅ Done |
| 3 | Active Incidents | `system-health/incidents/items/{id}` (status=open) | ✅ Done |
| 4 | Maintenance Banner | `system-maintenance/{component}` | ✅ Done |
| 5 | Recent Incidents (expandable) | `system-health/incidents/items/{id}` (resolved, last 10) | ✅ Done |

### Service Cards

Each card shows:
- Color indicator (green/yellow/red) based on `status` field + staleness thresholds
- Service name
- "Last seen: Xm ago"
- Key metrics (service-specific: messages, emails, samples, reports, etc.)

### Staleness Thresholds (hardcoded per spec)

| Service | Warning | Critical |
|---------|---------|----------|
| mqtt-bridge | 7 min | 15 min |
| ats-ingestion | 2h | 6h |
| vibration-processor | 30 min | 2h |
| reports-orchestrator | 24h (daily) | 24h |
| daily-prism-calc | 24h (daily) | 24h |

---

## Files Created

```
src/app/settings/system-monitoring/
├── system-monitoring.component.ts    (logic, Firestore subscriptions, helpers)
├── system-monitoring.component.html  (template with cards, table, incidents)
└── system-monitoring.component.scss  (responsive grid, color indicators)
```

## Files Modified

- `src/app/app.module.ts` — import + declaration
- `src/app/app-routing.module.ts` — route under `/settings/system-monitoring`
- `src/app/settings/settings.component.ts` — card, index, titles, navigation
- `src/app/settings/settings.component.html` — render at index 15

---

## Design Decisions

1. **Real-time listeners** (`valueChanges`) — auto-updates when backend writes heartbeats. No polling needed.
2. **Staleness logic lives in the UI** — simple thresholds from the spec. If a service reports `status: "healthy"` but its heartbeat is stale beyond threshold, the card still shows yellow/red.
3. **Firestore paths** — assumed `system-health/checks/items/{checkId}` and `system-health/incidents/items/{id}` as subcollections. If the backend uses a flat structure like `system-health-checks/{id}`, the query paths need a one-line fix.
4. **No actions** — strictly read-only per spec. No buttons, no mutations.
5. **No webapp usage metrics** — spec says "optional, low priority". Skipped for now; can add incrementing counters later once the team decides what's worth tracking.

---

## Feedback & Assumptions to Verify

### ⚠️ Firestore Path Assumption

The spec mentions:
- `system-health/checks/{checkId}`
- `system-health/incidents/{id}`

I interpreted these as subcollections under a `system-health` doc:
```
system-health (doc) → checks (subcollection) → items/{checkId}
system-health (doc) → incidents (subcollection) → items/{id}
```

If the backend writes to **root-level collections** like `system-health-checks/{checkId}`, this needs a path adjustment. Please confirm with backend.

### ⚠️ Reports/Prism "Didn't Run Today"

The spec says reports/prism should be critical "if didn't run today (check after 07:00)". Current implementation uses a simple 24h staleness threshold. A more precise check (compare against today 07:00 IL time) can be added if needed.

### ✅ Ready for Testing

Once the watchdog starts writing heartbeats and health checks to Firestore, this page will populate automatically. Until then it'll show "No heartbeats received yet" and empty sections.

---

## What's NOT Included (per spec — low priority)

- **Webapp Usage Metrics** — daily counters (`sensorDataFetches`, `uniqueUsers`, `signIns`). Deferred; trivial to add as a separate section once the team agrees on which counters matter.
