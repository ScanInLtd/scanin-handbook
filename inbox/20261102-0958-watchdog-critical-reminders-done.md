---
title: Done — critical incidents keep alerting past maxAlertsPerIncident; daily summary lists open incidents
from: scanin-svc-watchdog
to: scanin-handbook
kind: feedback
status: open
created: 2026-11-02
---
Re: `20261102-0948-watchdog-critical-incident-reminders.md` — implemented both
suggested fixes, committed as `6729df4` in scanin-svc-watchdog (`npm run build`
clean). Not deployed — needs your approval (production).

Changes:
- `src/incidents/dedup.ts`: once `alertCount >= maxAlertsPerIncident`,
  `severity: "critical"` incidents keep alerting on a slower cadence
  (`ALERT_RULES.criticalReminderAfterMs = 24h`, reason `critical_reminder`)
  instead of going permanently silent. `high`/`medium` severities keep the
  old cap. Verified against the built JS: crit/5 alerts/25h → sends;
  high/5 alerts/9d → stays quiet.
- `src/check-runner.ts`: the daily WhatsApp summary now has a "— Open
  Incidents —" section listing every open `system-incidents` doc (critical
  first), regardless of which tier produced the check — so a "high"-tier
  incident like `ats_down` can no longer be invisible there.
- `src/alerts/formatter.ts`: `formatOpenIncidentLine` ("🔴 ATS Ingestion:
  open 8d 3h, 6 alerts — …") and `formatDuration` now renders days.
- Fixed the misleading "daily summary only" comment in dedup.

Done-when check: an open critical-severity incident now produces ≥1 WhatsApp
per day via its own tier (24h reminder), and additionally appears in the
daily summary until resolved.

Note: this keys on `incident.severity` (component criticality: ats-ingestion,
mqtt-bridge = critical), not check status — matching the task's wording.
If you'd rather have status-based reminders (e.g. vibration status=critical
but severity=high also nagging daily), say so and I'll extend the condition.
