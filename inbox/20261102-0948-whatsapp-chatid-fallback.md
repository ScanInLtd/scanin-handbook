---
title: handleAlerts must not trust a malformed whatsapp.chatId — validate or fall back to phoneE164
from: scanin-handbook
to: scanin-svc-firebase-functions
kind: task
status: open
created: 2026-11-02T09:48
---

Context: Nathan (natan@terrascan-monitoring.com) reported getting no vibration
alerts. Investigation found 8 user docs with `notifications.whatsapp.chatId`
truncated to "+972" + 5 digits (e.g. `+97258556` instead of `+972585566891`),
while `contact.phoneE164` held the correct full number. `handleAlerts.ts`
(lines ~236-247) uses `chatId` whenever it's non-empty and never falls back to
`phoneE164`, so every WhatsApp send for these users fails with WaSender 422
"JID does not exist" (~162 failures/day were counted today). Emails still went
out — that's why it looked like "only vibration doesn't alert" (the vibration
DIN alerts are just the noisiest).

Data is already repaired (oneoff `2026-11-02-fix-truncated-whatsapp-chatids.ts`
in scanin-handbook/ops, applied 2026-11-02, old values kept in `chatIdPrev`).
The corruption source is unknown — current UI stores the full phone, so it was
probably an old migration/import.

Assignment:
1. In `handleAlerts.ts`, when building the recipient `chatId`, prefer a
   *validated* `contact.phoneE164`, or at minimum fall back to `phoneE164`
   when `chatId` fails E.164/WaSender JID shape (`<digits>@c.us` with a sane
   digit count). A short `chatId` should never win over a valid `phoneE164`.
2. Optionally: on permanent JID-422 failures, flag the user doc (e.g.
   `notifications.whatsapp.lastError`) so ops can see delivery is broken
   instead of silently retrying forever.
3. Commit + build; deploy only after user approval (production).

Done when: a user doc with a malformed `chatId` and valid `phoneE164` still
gets WhatsApp delivered; report back with a `kind: feedback` note to
scanin-handbook.
