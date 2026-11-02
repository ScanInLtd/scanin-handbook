---
title: WhatsApp chatId fallback implemented — validated phoneE164 wins, broken recipients flagged
from: scanin-svc-firebase-functions
to: scanin-handbook
kind: feedback
status: done-local
created: 2026-11-02T12:15
---

## What changed

Commit `581a97a` on `master` (4 files, **built + linted, NOT deployed** — awaits user approval).

- `src/alerts/whatsappService.ts` — new `resolveWhatsAppChatId(rawChatId, phoneE164)`:
  a validated `contact.phoneE164` (11–15 digits, same "real intl number" boundary as the
  `2026-11-02-fix-truncated-whatsapp-chatids` oneoff) always wins; a malformed/truncated
  `chatId` falls back to it; `@g.us` group JIDs pass through untouched; returns `null`
  instead of queueing a guaranteed-422 recipient. Also `flagWhatsAppRecipientError` /
  `clearWhatsAppRecipientError` / `isRecipientJidError` helpers.
- `src/alerts/handleAlerts.ts` — uses the resolver; pending outbox entries now carry
  `userId`; a whatsapp-enabled user with **no** deliverable recipient gets
  `notifications.whatsapp.lastError` set on the user doc at queue time.
- `src/alerts/multiSensorAlerts.ts` — same fallback (legacy fields
  `whatsapp.chatId` / `phone` / `phone-number`, now also checking `contact.phoneE164`);
  recipients carry `userId`.
- `src/alerts/whatsappSender.ts` — on permanent recipient-class failure
  (WaSender 422 / "JID") the user doc gets `notifications.whatsapp.lastError`
  `{at, chatId, error}`; cleared on the next successful send to that user. Alert-doc
  `whatsapp.failed` semantics unchanged.

## Done-when check

User doc with malformed `chatId` + valid `phoneE164` → resolves to the phoneE164 JID.
Verified against the compiled lib, e.g. `("+97258556", "+972585566891") → "972585566891@c.us"`;
`("+97258556", undefined) → null` (no send, flag set instead); groups pass through;
422-class errors flagged, 429s not.

## Data note (read-only audit, `ops/src/queries/users-whatsapp.ts`)

Post-repair state is clean: 25 users, 15 whatsapp-enabled, **0 chatId/phoneE164
mismatches, 0 short chatIds**. But **4 enabled users have no recipient at all**
(`refael eng`, `ברוך עיר דוד`, `jtcs control`, `בקרה תחנת רכבת ירושלים מרכז`) — after
deploy these get surfaced via `lastError` instead of staying invisible. The audit
query is committed in `ops/src/queries/users-whatsapp.ts` for re-checks.

## Verification

- `nvm use 20 && npm run build` — clean.
- `npm run lint` — 0 errors (3 pre-existing warnings in `setup-notification-config.ts`).
- Resolver exercised over 11 edge cases against `lib/` output — all correct.

## Pending

- Production deploy (`./DEPLOY.sh handleAlerts` + `sendWhatsappAlerts` +
  `evaluateMultiSensorRules`, or full deploy) — waiting on your approval.
