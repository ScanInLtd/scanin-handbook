---
title: Reports UI — show "completed, no email sent" with the reason, and flag recipients that no longer exist
from: scanin-handbook
to: scanin-web-platform
kind: task
status: open
created: 2026-10-24T19:30
---
Context: on 23.10 Nathan triggered the DeVinci report REP141 (`ReportConfig/Nn5D8EIN9shaaSvhCqPO`). The first run sent **no email**: its only recipient, user `YBlFQ7DVdhRkjhxbnQKRBxMG0TG3`, no longer exists in `users`. The worker skipped the send, but the report card showed a normal **completed**. The config had kept the deleted user id in `recipients.users` without any warning. (Full timeline: the reports task `inbox/20261024-1930-report-email-skipped-status.md`.)

The reports service will add to the terminal status (`lastStatusDetails`, and the `ReportRuns` doc for merged runs):
`emailSent` (exists today), `emailSkipReason` (`no_recipients` | `unresolved_recipients` | `send_failed` | `link_failed`), `unresolvedUsers` (user ids), `recipientsSent`. Treat the new fields as optional, so the UI works before and after that deploy.

Assignment:
1. **Report list / live panel: completed but no email.** When `lastStatus === 'completed'` and `lastStatusDetails.emailSent === false`, show a distinct state, e.g. an amber "הושלם — לא נשלח מייל", not the green success.
   - With `emailSkipReason`, add the reason in Hebrew: no recipients ("אין נמענים") / recipients not found ("נמענים לא נמצאו: …", with names if resolvable, else ids) / send failed ("שליחת המייל נכשלה").
   - `emailSent: true` with non-empty `unresolvedUsers` → success plus a small warning ("חלק מהנמענים לא נמצאו").
   - Same for merged runs.
2. **Report editor: recipients that no longer exist.**
   - When loading a config, check each `recipients.users` id against `users`. Show a missing one as a red chip "משתמש לא קיים (…id)" with a remove ×.
   - Saving with a missing user: block it, or remove it after a confirm.
   - The existing rule stays: at least one **valid** recipient is required.
3. **Report list hint:** a report whose recipients are all missing gets a warning icon, so the problem is visible before anyone triggers it.
4. Check: point a test config's `recipients.users` at a non-existent id → the editor flags it, and the list shows the warning. A run on it shows "הושלם — לא נשלח מייל" (with the reason once the reports change is live). REP141 today has a valid recipient (Nathan), so it must show no warning.

Rules: build (Node 12) before deploy; preview channel first. Hillel approves the live deploy.

Done when: deployed, and a `kind: feedback` message to `user` with the commit, the bundle hash and screenshots (or a description) of the amber state and the missing-user chip.
