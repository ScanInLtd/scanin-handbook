---
title: Record why a report run sent no email (unresolved / no recipients), so the UI can show it
from: scanin-handbook
to: scanin-svc-reports
kind: task
status: open
created: 2026-10-24T19:30
---
Context: on 23.10 Nathan triggered the DeVinci report REP141 (`ReportConfig/Nn5D8EIN9shaaSvhCqPO`) twice. He says nothing reached his email. Investigated read-only on 24.10 (worker + orchestrator logs, Firestore):

| Trigger (UTC) | Config recipient at the time | Worker log | Config status written |
|---|---|---|---|
| 13:13Z (pid 2931) | `users: ["YBlFQ7DVdhRkjhxbnQKRBxMG0TG3"]` | `⚠️ User not found` → `❌ No valid email recipients found … Skipping email delivery` → `0 emails sent` | `lastStatus: completed` (`emailSent: false`) |
| 13:16Z (pid 6949) | `users: ["EO4erXl8…"]` (Nathan; config edited 13:13:52Z) | `✅ Email sent successfully` to natan@terrascan-monitoring.com, 5.5 MB PDF attached | `completed`, `emailSent: true` |

The first run built the whole PDF (158 s) and ended as a plain **`completed`**, although nothing was sent and the only recipient no longer exists. The only trace is `lastStatusDetails.emailSent: false`, with **no reason**. The UI therefore shows a success. (Whether the second email was delivered is a separate SendGrid/inbox question; it's not part of this task.)

Related open feedback: `inbox/20261020-2005-merged-run-stuck-email-sending.md`. A merged run with **0 recipients** never left `email_sending`. Please cover both with the same change.

Assignment:
1. **`sendReportEmail` returns a result object**, not `true/false`, e.g.
   `{ sent: boolean, reason?: 'no_recipients' | 'unresolved_recipients' | 'send_failed' | 'link_failed', recipientsSent: string[], unresolvedUsers: string[], error?: string }`.
   - `unresolvedUsers`: user ids that don't exist or have no `email` (today only logged as `❌ Failed to resolve user …`).
   - **Partial failures count too:** sent to some, others unresolved → `sent: true` + `unresolvedUsers` filled.
2. **Write it to the config's terminal status** for sensor / group / merged runs, in `lastStatusDetails` next to `emailSent`:
   - `emailSkipReason`, `unresolvedUsers`, `recipientsSent` (count or list).
   - Keep `lastStatus: completed` (the PDF *was* generated). Don't add a new status value; the UI will branch on `emailSent` + `emailSkipReason`.
   - Same fields on the `ReportRuns` doc for merged runs.
3. **Every exit from the send step writes a terminal status:** empty recipients, all unresolved, SendGrid error, link upload failure. No run may stay in `email_sending` (the 20.10 case).
4. **Fail fast, optional but preferred:** resolve recipients **before** rendering. If there are none at all (no direct emails, all users unresolved) and the run was triggered manually, still generate the PDF (`GeneratedReports` / storage as today), but log it clearly at the start, so a 2.5-min run doesn't silently end without email.
5. Tests / check:
   - a config whose only user id doesn't exist → `completed`, `emailSent: false`, `emailSkipReason: 'unresolved_recipients'`, `unresolvedUsers: [id]`;
   - empty recipients → `completed`, `emailSkipReason: 'no_recipients'` (not stuck in `email_sending`);
   - one valid + one deleted user → `emailSent: true`, `unresolvedUsers: [deleted]`.

Don't: send real emails to client addresses while testing (use a test config with your own address or a dry-run flag). Deploy the worker only after the checks pass. Hillel approves the deploy.

Done when: deployed, and a `kind: feedback` message to `user` with the commit, the new `lastStatusDetails` shape (for web-platform, see `inbox/20261024-1930-report-recipients-ui.md`) and the three check results. Also close the 20.10 feedback.
