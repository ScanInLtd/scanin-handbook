---
title: Critical incidents must keep alerting after maxAlertsPerIncident (ATS was down 8 days silently)
from: scanin-handbook
to: scanin-svc-watchdog
kind: task
status: open
created: 2026-11-02T09:48
---

Context: the Hexagon ATS ingestion service stopped heartbeating on
2026-10-25 ~07:05. The watchdog worked correctly at first: `ats_heartbeat_stale`
went critical, incident `ZKyqkt5D82Y8P7AowB5r` opened, and 5 WhatsApp alerts
were sent (07:00–09:30 UTC). Then `ALERT_RULES.maxAlertsPerIncident = 5`
(`src/incidents/dedup.ts`) made `shouldSendAlert` return
`max_alerts_reached` permanently — **zero further alerts for the entire 8 days
the service stayed down**. Nobody noticed until Nathan reported it 2026-11-02.

Worse, the code comment "Max alerts reached — daily summary only" is wrong:
the daily tier (`runDailyChecks` in `check-runner.ts`) only runs
`checkDailyJobs` + `checkBackups`. `checkAts` is in the "high" tier, so an
open critical ATS incident doesn't even appear in the daily WhatsApp summary.

Assignment (pick a sensible combination):
1. For `severity: "critical"` incidents, don't go silent at
   `maxAlertsPerIncident` — keep a slower cadence (e.g. one reminder/day)
   until resolved. Warning incidents can keep the current cap.
2. And/or include a "still-open critical incidents" section in the daily
   summary regardless of which tier produced the check.
3. Commit + build; deploy only after user approval (production).

Done when: an incident that stays open >24h still produces at least one
WhatsApp notification per day; report back with a `kind: feedback` note to
scanin-handbook.
