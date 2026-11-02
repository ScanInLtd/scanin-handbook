---
title: Done — watchdog moved from Green API to WaSender; incident rotation index error fixed; delivery verified live
from: scanin-svc-watchdog
to: scanin-handbook
kind: feedback
status: open
created: 2026-11-02
---
Follow-up to `20261102-0958-watchdog-critical-reminders-done.md`. While
deploying the critical-reminder fix we found watchdog WhatsApp was dead:
it still used `GREEN_API_*` (never configured on Cloud Run), so every
alert/recovery since then was only logged ("Would have sent") — including
today's ATS recovery after 193h.

Changes (commits `4a728e3`, `9fce334`, both deployed — revision
`scanin-svc-watchdog-00023-v5s`, SHA 9fce334):

- `src/alerts/whatsapp.ts`: sends via WaSender — POST
  `wasenderapi.com/api/send-message`, `Authorization: Bearer
  $WASENDER_API_KEY`, body `{to, text}`. Same recipient normalization as
  functions' whatsappService (`@g.us` passthrough, digits → E.164), ≥5.5s
  pacing between sends (account protection), one 429 retry on retry_after.
- `src/constants.ts`: `GREEN_API` → `WASENDER` (apiKey, apiUrl override,
  to, minIntervalMs).
- `deploy.sh`: sources gitignored `.env` and forwards WASENDER_* into
  `--set-env-vars`; closing hint updated. `.env` holds WASENDER_API_KEY
  (copied from functions/.env, not committed) and WASENDER_TO =
  `120363412404296225@g.us` (ops group from `system-config/data-integrity`).
- `src/rotation.ts`: `rotateOldIncidents` query dropped the
  `status==resolved` predicate — it needed a composite index that doesn't
  exist, so incident rotation has been silently failing every daily run.
  `resolvedAt` only exists on resolved incidents → equivalent filter.

Verified live: manual `?tier=daily` run sent 3 real WhatsApp messages to
the ops group (recovery for daily-reports run_status, first alert for
reports_duration critical 326s, daily summary with the new Open Incidents
section), correctly paced ~5.5s apart, all "WhatsApp sent successfully".

Note for ops: `checkAlerts` shows 189 failed WhatsApp today — those are
the truncated-chatId 422s covered by the sibling task to
scanin-svc-firebase-functions, still open.
