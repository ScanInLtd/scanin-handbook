---
title: Firmware rules contract decisions + authorization to deploy rules/CORS
from: scanin-handbook
to: scanin-svc-firebase-functions
kind: task
status: open
created: 2026-11-02T12:05
---

You hold the rules/infra contract per
`20261102-1051-firmware-ui-infra-launch-gates.md` (web-platform handoff)
and `20261101-1744-firmware-infra-security.md`. Hillel wants this finished
urgently — **no further approval needed** for the deployment steps below.

## Contract decisions

- **Authorization model — keep it simple: admin users of the front can
  flash.** Canonical role is `users/{uid}.admin == true` for the firmware
  collections (releases, `firmware-release-settings/datalogger`,
  `firmware-flash-log`). No legacy `isAdmin` alias for firmware. Still
  required: block self-promotion (a user must not be able to write their
  own `admin` field) and close any permissive catch-all covering these
  collections — scope changes to firmware paths only, preserve all
  unrelated app/mobile flows.
- **`updatedBy`: caller email** — agreed (matches UI implementation and
  audit `userEmail`).
- **Pre-probe audit cancellation: permitted.** Allow `firmware-flash-log`
  create with `result:'started'` + caller fields (`userUid`, `userEmail`,
  `userAgent` ≤512, `startedAt`) and device/release fields optional until
  identified; single creator-only terminal update as specified.
- **Bearer-token firmware downloads — ACCEPTED by Hillel.** Possession of
  the URL grants download independent of rules; that is the accepted
  distribution mechanism, so do not try to make Storage rules gate it.

## Required work, then deploy

1. Read-only: confirm the currently deployed Firestore/Storage rulesets
   and which repo's copy is the live source of truth; keep both copies
   synchronized after edit.
2. Write the rules + emulator tests (non-admin denial, self-promotion
   denial, immutable binary/OTA/provenance fields, metadata limits,
   pointer eligibility + withdraw/demote clearing, audit
   create/finalize/immutability, profile-flow regression).
3. Bucket CORS: merge required production origins + `localhost:3020`
   (4200 only if actually used); preserve existing entries.
4. **Deploy when done**: `firebase deploy` the Firestore rules + Storage
   rules/CORS (and IAM only if the publisher run proves it's needed).
5. Grant `admin: true` on **Hillel's and Lidor's** user docs so they can
   reach the firmware card for the smoke session. Nobody else.

Report back with `kind: feedback`: source-of-truth findings, rules/test
results, exact CORS diff applied, what was deployed.
