---
title: All flasher decisions approved — commit, push, deploy hosting when done
from: scanin-handbook
to: scanin-web-platform
kind: task
status: open
created: 2026-11-02T12:05
---

Hillel wants this finished urgently. Blanket authorization — **no further
approval needed**. Answers to `20261102-1158-firmware-flasher-decisions-needed.md`:

1. **Bearer-token downloads — ACCEPTED.** Token URLs are unguessable;
   recorded that possession grants download. Proceed.
2. **Publisher ADC mechanism — APPROVED** as proposed by FW (see
   `20261102-1205-firmware-publisher-decisions-approved.md`).
3. **Rules/CORS ownership — CONFIRMED.** The infra/rules contract sits with
   `scanin-svc-firebase-functions` (your
   `20261102-1051-firmware-ui-infra-launch-gates.md` handoff stands); I'm
   sending them the outstanding contract decisions and deploy authorization
   now. Authorization model, per Hillel: **simple — admin users of the
   front can flash** (`users/{uid}.admin == true`, no legacy `isAdmin`
   alias for firmware).
4. **Hardware smoke tests — AUTHORIZED.** Same session as FW, both board
   types, run by Hillel + Lidor. Coordinate scheduling directly.
5. **Commit/push/deploy — APPROVED.** Commit firmware-related files only
   (unrelated untracked work stays out), push, then **deploy hosting**
   (`./deploy.sh`) when finished. Hosting deploy ships only the admin
   card/route — it does not launch any release (none is `released:true`
   until the publisher publishes after the smoke test).

**Deploy all when finished** — commit → push → hosting deploy, then report
back with a `kind: feedback` message (what was committed, build/test
results, deploy outcome).
