---
title: Firmware rules contract implemented, emulator-tested, DEPLOYED (rules + storage + CORS); admins already set
from: scanin-svc-firebase-functions
to: scanin-handbook
kind: feedback
status: done
created: 2026-11-02T12:40
---

## Source of truth

Deployed ruleset (fetched via firebaserules API before editing): **the
web-platform copies were live** — `cloud.firestore` and
`firebase.storage/dataloggerdev.appspot.com` rulesets (created 2026-10-20)
were byte-identical to `scanin-web-platform/{firestore,storage}.rules`.
The functions-repo `firestore.rules` was a stale Rowy-era file — a landmine:
any `firebase deploy --only firestore` from that repo would have clobbered
the real ruleset. Both repos now carry the **identical** new file.

## What was written & deployed

**Firestore rules** (deployed `firebase deploy --only firestore:rules,storage`
from scanin-web-platform; ruleset `7c384d5d-…` verified byte-identical post-deploy):

- `esp_datalogger_firmware`: admin read; client create/delete denied; update =
  metadata-only allowlist `{title,notes,channel,withdrawn,withdrawnReason,
  updatedAt,updatedBy}` — title 1-200 single-line, notes ≤20k, channel enum,
  `updatedAt == request.time`, `updatedBy == request.auth.token.email`,
  withdrawnReason 1-1000 required when withdrawn and absent otherwise.
  Binary/provenance/OTA fields (`parts`,`url`,`released`,`version`,`gitCommit`,
  `totalSize`,`chip`,`recommended`,…) immutable for ALL clients incl. admins.
  Withdraw/demote of the pointed release **must clear the pointer in the same
  transaction** — enforced via `existsAfter`/`getAfter`.
- `firmware-release-settings/{doc}`: admin read; exact-keys
  `{recommendedVersion,updatedAt,updatedBy}`; pointer must be null or target an
  existing stable + non-withdrawn release (post-transaction state).
- `firmware-flash-log`: admin create with `result:'started'` + caller fields
  (`userUid==uid`, `userEmail==token.email`, `userAgent`≤512, `startedAt==request.time`)
  + optional device/release fields (mode/boardBefore/chip/usbType enums).
  Finalize once, creator-only: `result→success|failed|cancelled` +
  `finishedAt==request.time` + optional `bootVerification`/`observedVersion`/
  `durationMs`/`error`≤2000. No deletes, no re-edits.
- `users`: nobody — admin or not — can write **their own** `admin` field
  (create or update). Admins manage `admin`/`projects` on other users.
  Self-update still can't touch `projects`.
- Catch-all narrowed: `users`, `esp_datalogger_firmware`,
  `firmware-release-settings`, `firmware-flash-log` excluded from the
  `request.auth != null` fallback; every other collection's behavior unchanged
  (open mobile `projects`/calibration rules preserved).

**Storage rules**: `firmware/` → authenticated read, `write:false` (publisher
is Admin SDK). Bearer-token downloads unaffected — accepted model per decision.

## Emulator tests — 96/96 pass

`scanin-svc-firebase-functions/tests/rules/firmware-rules.test.mjs` (run:
`npm run test:rules`, needs a JDK — used `/opt/homebrew/opt/openjdk@17`).
Covers: unauthenticated + non-admin denial on all firmware paths,
self-promotion on create/update, profile-flow regression, metadata limits +
caller/time validation, immutable-field matrix, pointer eligibility incl.
same-transaction withdraw/demote clearing, audit create/finalize/
immutability/ownership, catch-all regression for unrelated collections.
devDeps: `@firebase/rules-unit-testing` + `firebase` (not in deploy bundle).

## CORS — applied to gs://dataloggerdev.appspot.com

Previously **empty**. Now:
`[{origin:[https://new-scanin-ui.web.app, https://new-scanin-ui.firebaseapp.com,
http://localhost:3020], method:[GET], responseHeader:[Content-Type],
maxAgeSeconds:3600}]`
4200 excluded — `angular.json` pins dev server to 3020.

## Admin grants — already satisfied, no write needed

`users/64UZS6SPMIUfGxihIahZ0RzBbgF3` (הלל וידל, hillelvidal@gmail.com) and
`users/deRYjwq2vPMK8fDpAuGZbEzmk8B2` (לידור לבקוביץ,
lidor@terrascan-monitoring.com) **already have `admin: true`**. Nathan
(`natan@terrascan-monitoring.com`) also has it. Nobody else was touched.

## Commits

- functions `361c8fa` (rules + test suite + devDeps)
- web-platform `70c8130` (synced firestore.rules + storage.rules firmware block)

## Not done / watch items

- `users` subcollections, if anything ever uses them, are now denied to
  clients (excluded from catch-all; `users/{id}` block has no nested match).
  No current usage found in the UI codebase.
- `firmware-release-settings` enforces exact keys — a stray extra field on the
  doc would block client writes until removed (schema-strict by design).
- Publisher IAM/ADC verification remains a FW/infra item per the original task.
- Rollback: previous rulesets `a4ea0e0d` (firestore) / `69a9ff75` (storage)
  remain in the project — re-release them to roll back.
