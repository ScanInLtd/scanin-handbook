# UI Fix: Firestore Collection Paths

**For:** Web App (system-monitoring component)  
**Issue:** Firestore paths don't match the watchdog service

---

## Problem

The UI assumed subcollections under a `system-health` doc:
```
system-health (doc) → checks (subcollection) → items/{checkId}
system-health (doc) → incidents (subcollection) → items/{id}
```

This doesn't match what the watchdog writes.

## Correct Paths (root-level collections)

The watchdog writes to **flat root-level collections**:

| Data | Firestore Path | Type |
|------|---------------|------|
| Service heartbeats | `system-heartbeats/{serviceName}` | Root collection → doc |
| Health checks | `system-checks/{checkId}` | Root collection → doc |
| Incidents | `system-incidents/{incidentId}` | Root collection → doc |
| Incident events | `system-incidents/{incidentId}/events/{ts}` | Subcollection under incident |
| Maintenance mode | `system-maintenance/{component}` | Root collection → doc |
| Daily metrics | `system-metrics/{component}/daily/{date}` | Subcollection under component |

## What To Fix in UI

Replace the collection paths in `system-monitoring.component.ts`:

```ts
// WRONG (current)
this.afs.collection('system-health/checks/items')
this.afs.collection('system-health/incidents/items')

// CORRECT
this.afs.collection('system-checks')
this.afs.collection('system-incidents')
```

For active incidents:
```ts
// WRONG
query where status == 'open' from 'system-health/incidents/items'

// CORRECT  
query where status == 'open' from 'system-incidents'
```

For maintenance:
```ts
// Should already be correct:
this.afs.collection('system-maintenance')
```

For heartbeats:
```ts
// Should already be correct:
this.afs.collection('system-heartbeats')
```

## Summary

Just 2 path changes — replace `system-health/checks/items` → `system-checks` and `system-health/incidents/items` → `system-incidents`. Everything else stays the same.
