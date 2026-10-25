---
title: Reports worker records why no email was sent (emailSkipReason etc.) — deployed
from: scanin-svc-reports
to: user
kind: feedback
status: open
created: 2026-10-24T20:00
---
Done for `inbox/20261024-1930-report-email-skipped-status.md`. Also closes `inbox/20261020-2005-merged-run-stuck-email-sending.md`.

**Commit:** `90e8b95` on `master` ("Record why a report run sent no email: emailSkipReason + unresolvedUsers")
**Deployed:** `reports-worker-00122-gux` (image `reports-worker:90e8b95`, 100% traffic, boot log confirmed) and `reports-orchestrator-00007-j97` (100% traffic — needed so its terminal write carries the new fields for merged runs). Both `/health` and `/` respond.

**New `lastStatusDetails` shape** (on `completed`; also on the `ReportRuns` doc for merged runs):

```json
{
  "emailSent": false,
  "emailSkipReason": "no_recipients | unresolved_recipients | send_failed | link_failed",   // only when sent=false
  "unresolvedUsers": ["<userId>", "..."],   // user ids that don't exist / have no email
  "recipientsSent": ["a@b.c", "..."],       // addresses the email went to
  "emailError": "<message>"                 // only on send_failed / link_failed
}
```

`emailSent`/`unresolvedUsers`/`recipientsSent` are always present on completed runs; `emailSkipReason`/`emailError` only when relevant. `lastStatus` stays `completed` (PDF was generated) — UI branches on `emailSent` + `emailSkipReason`, matching `inbox/20261024-1930-report-recipients-ui.md` and its deployed implementation.

**What changed:**

- `sendReportEmail` (SendGrid, Nodemailer, hybrid) returns `{ sent, reason?, recipientsSent, unresolvedUsers, error? }` instead of `true/false`; `scripts/services/emailRecipients.js` holds `resolveEmailRecipients` + `normalizeEmailResult` + `emailResultDetails`.
- Every exit from the send step lands a terminal status. For merged runs the **worker** now writes `completed`/`failed`/`cancelled` on the config itself — a run can no longer sit in `email_sending` if the orchestrator dies mid-`/merge-run` (the REP-M-TEST case; the orchestrator still rewrites `completed` with `runDurationMs` + `pages` when it's alive).
- Recipients are resolved and logged **before** rendering, so a dead recipient list shows up in the log at the start of a run instead of after a 2.5-min build. The PDF is still generated as before.
- Nodemailer fallback now resolves `recipients.users` too (previously it silently ignored them).

**Check results** (local, SendGrid `send` stubbed — no real emails sent; only a read-only `users` lookup):

1. only recipient is a deleted user id → `sent:false`, `emailSkipReason:'unresolved_recipients'`, `unresolvedUsers:[id]` → worker writes `completed`. ✅
2. empty recipients → `sent:false`, `emailSkipReason:'no_recipients'` → `completed`, never stays in `email_sending`. ✅
3. one valid + one deleted user → `sent:true`, `recipientsSent:[valid]`, `unresolvedUsers:[deleted]`. ✅
   (also covered: missing PDF → `send_failed`; no email service configured → `send_failed`.)

Not run end-to-end against a live Firestore config (would need a real render + a test config doc); the fields written above are the exact `emailResultDetails()` output passed to `updateReportStatus`. First real run to exercise it: any config with a dead user id, or REP141 if its recipient list goes stale again.

Note: a deploy-time warning appeared — `module 'importlib.metadata' has no attribute 'packages_distributions'` — it's a gcloud/Python-3.9 CLI warning printed after successful deploys, not from the service.
