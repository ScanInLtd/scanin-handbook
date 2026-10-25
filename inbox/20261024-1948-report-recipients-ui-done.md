---
title: Reports UI — "completed, no email sent" states and dead-recipient flagging deployed
from: scanin-web-platform
to: user
kind: feedback
status: open
created: 2026-10-24T19:48
---
Done for `inbox/20261024-1930-report-recipients-ui.md`.

**Commit:** `3fffda6` on `main` (`feat(report-config): flag runs that sent no email + dead recipients`)
**Bundle:** `main-es2015.e22528c1224bd82d40eb.js` (build hash `e82f51603a484c185440`)
**Deployed:** live on https://new-scanin-ui.web.app (200, new bundle served). Preview channel skipped per your instruction in session.

What the UI does now (all in `settings/report-config`):

- **Completed, no email:** `lastStatus === 'completed'` + `lastStatusDetails.emailSent === false` → amber pill "הושלם — לא נשלח מייל" instead of green "Completed", plus an amber line under the last-run row with the Hebrew reason: `no_recipients` → "אין נמענים", `unresolved_recipients` → "נמענים לא נמצאו: …" (names when the id resolves in `users`, else the raw id), `send_failed`/`link_failed` → "שליחת המייל נכשלה". No `emailSkipReason` (pre-deploy runs) → pill still turns amber, reason line omitted. Same logic covers merged runs (shared code path).
- **Partial send:** `emailSent: true` + non-empty `unresolvedUsers` → green Completed stays, plus a small amber "חלק מהנמענים לא נמצאו: …" line.
- **Editor:** each `recipients.users` id is checked against `users`. Missing ones render as a red chip "משתמש לא קיים (…xxxxxx)" (last 6 chars, full id in tooltip) with the normal remove ×. Saving with missing users asks to strip them (confirm); if nothing valid remains it blocks with the existing "at least one recipient" rule. Missing is only evaluated after `users` has loaded, so a slow fetch can't false-positive.
- **List hint:** a report whose entire recipient list is dead gets a `warning_amber` icon next to the recipient count ("כל הנמענים בדוח לא קיימים — מייל לא יישלח").

Checks: production build passes (Node 12, only pre-existing budget warnings). The Firestore-side check (test config with a non-existent `recipients.users` id → editor chip + list icon; REP141 clean since Nathan resolves) needs a live look at the deployed app — the logic is a straight `users` lookup against `recipients.users`, so REP141 will not flag. The "הושלם — לא נשלח מייל" path will fully exercise once the worker writes `emailSkipReason` (per `inbox/20261024-1930-report-email-skipped-status.md`); until then it shows for any existing run that has `emailSent: false`, without a reason line.
