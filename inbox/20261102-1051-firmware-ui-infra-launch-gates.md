---
title: Agree firmware UI rules contract and unblock production authorization
from: scanin-web-platform
to: scanin-svc-firebase-functions
kind: handoff
status: open
created: 2026-11-02T10:51+02:00
---

Please coordinate with Hillel, the designated infra/security owner of `20261101-1744-firmware-infra-security.md`, and the existing catch-all hardening task. This is a contract/dependency handoff, **not permission for a competing rules rewrite or production deployment**. Web has not edited either rules copy or deployed anything. Hillel requested production readiness work; hosting deployment remains blocked by the gates below.

## Current UI contract for rules agreement

- Canonical role is strictly `users/{uid}.admin == true`; firmware route explicitly does not accept the legacy `isAdmin` alias. A route guard is not the data security boundary.
- Admin-only registry/settings/audit reads. Browser release create/delete denied. Browser binary/provenance/build/OTA fields immutable, including `released` regardless of its existing value and deprecated per-release `recommended`.
- Release metadata updates ONLY `title` (nonempty single line, <=200), `notes` (<=20000), `channel` (stable/beta/dev), `withdrawn` (boolean), `withdrawnReason` (required nonempty <=1000 when withdrawing; removed on restore), `updatedAt` (server timestamp), `updatedBy` (**caller email in current UI**, please explicitly agree this vs UID before finalizing rules).
- `firmware-release-settings/datalogger`: `recommendedVersion` string or null, `updatedAt`, `updatedBy` (email). Only an eligible stable, non-withdrawn release may be targeted. Validate `getAfter` state and atomically clear pointer when target is withdrawn/demoted. Current UI transactions read all documents before writing; pre-existing read-after-write bug has been fixed and unit-tested. No collection-wide recommended flags/batches.
- `firmware-flash-log/{autoId}` creation: `result:'started'`, `userUid`, `userEmail`, `userAgent` (truncated to 512), `startedAt`; currently known device/release fields are `deviceId` (station MAC), `version`, `mode`, `boardBefore`, `chip`, `usbType`. This UI logs after successful probe / selected release, before any destructive command. It does not fabricate IDs for picker/pre-probe cancellation. Please agree whether to omit such pre-identification attempts or permit an explicitly optional-field create schema.
- One terminal update by the creator: ONLY `result` (success/failed/cancelled), `finishedAt` server time, `bootVerification` (confirmed/unconfirmed/not-attempted), optional `observedVersion`, `durationMs`, `error` (redacted <=2000). Caller/device/release/start fields immutable. No deletes or later terminal edits. UI retry after uncertain acknowledgment reads an already matching terminal record without rewriting it. Define success as verified writing, not proven boot.
- Initial audit failure blocks all erase/write; final audit failure preserves truthful result and provides retry without reflashing. Browser audit is best-effort, not tamper-proof proof of a physical flash.

## Required before production

1. Identify actual deployed Firestore/Storage rules, actual bucket and canonical deployment source through read-only inspection. The authenticated catch-all and profile self-promotion path must both be closed for these collections/role fields; narrow firmware allow statements alone cannot override existing broad allows. Preserve unrelated profile/app/mobile flows.
2. Owner-approved synchronized rules and emulator tests: unauthenticated/non-admin denial, self-promotion denial, immutable binary/OTA/provenance fields, metadata limits/caller/time, pointer eligibility and concurrent recommendation/withdrawal/demotion, audit ownership/transition/immutability, profile regression tests. The web suite's mocked transactions are **not** emulator-rule or concurrency proof.
3. Hillel must explicitly accept or reject **bearer-token firmware distribution**. Current UI downloads the supplied `parts[].url`, manifest URL and sidecar URL; possession of these URLs grants downloads independent of Firebase rules. If rejected, agree an authenticated download contract with FW/UI before integration. Do not label token URLs admin-only.
4. Inspect and propose merged bucket CORS for actual hosting origins plus localhost:3020; preserve existing entries. Confirm whether 4200 is actually used. Do not apply CORS/IAM/rules without separate approval.
5. Publisher ADC principal/IAM pinning and verification remain FW/infra responsibilities; Admin SDK bypasses these rules.

## Verified on web side

Node 12 focused suite: **59 passed**, including FW local fixture hashes/MD5/manifest mapping/image headers, transaction ordering, chip/capacity/security gates, sector preservation, withdrawal boundary, cancel/write behavior, port loss cleanup, boot mismatch/timeout, audit failures/retry and double-click lock. No Firestore emulator or production data access was used. No binary fixture was copied or distributed. Hardware acceptance remains separately pending.

Please return a `kind: feedback` message with the agreed schema (especially updatedBy identity and pre-probe cancellation), rule source-of-truth findings, emulator results, approval/deployment plan, bearer-link decision and actual bucket/origins. No MQTT bridge, pilot or legacy-tool changes are needed.
