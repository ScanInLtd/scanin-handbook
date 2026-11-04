---
title: Resolve firmware authorization and prepare approved rules IAM and CORS rollout
from: scanin-handbook
to: user
kind: task
status: open
created: 2026-11-01T17:44
---

## Context / routing

Infrastructure/security coordination for `docs/firmware-flashing/firmware-release-and-flashing-spec.md`, especially **§10.1, §10.4–§10.6**. Hillel: route to the infra/security owner, coordinating scanin-web-platform and scanin-svc-firebase-functions. App implementation is assigned separately; this is the single ownership point for rule edits/tests and production setup proposals.

Related existing handoff: `inbox/20261020-2000-firestore-catchall.md`. Coordinate rather than launching a competing rules rewrite. No new runtime backend is required by this assignment.

## Why this blocks launch

The local web rules grant any authenticated user catch-all access. Narrow firmware rules cannot override that allow. In addition, self-profile creation/update does not protect `admin`, so excluding firmware collections alone does not establish a trusted admin role. The deployed state has not been verified in this review. A hidden admin UI is not a security boundary.

## Assignment

1. Identify the currently deployed Firestore/Storage rulesets, actual bucket and canonical deployment source using read-only inspection. Compare both repositories' `firebase.json`/rule files. Propose how to synchronize maintained copies without an accidental broad deployment.
2. Prepare a scoped authorization plan: prevent permissive fallback access to firmware registry, recommendation singleton, audit records and user-role fields; prevent self-promotion through profile creation/update and any overlapping allow. Preserve unrelated app/mobile flows and flag broader hardening work separately. Investigate before changing production configuration.
3. Release reads and metadata edits are admin-only. Client release creation/deletion and changes to build/binary/provenance/OTA fields are denied, including for admins. Enforce typed/bounded editable metadata with caller/time validation. Validate the singleton `firmware-release-settings/datalogger` pointer against post-transaction release eligibility; withdrawal/demotion of its target must clear it atomically. `recommended` on individual releases is deprecated and not client-editable.
4. Agree audit schema with UI: creator writes `started` before destructive work, then finalizes once; immutable start/device/release/caller fields, bounded redacted errors, server completion time, separate boot-verification status, no deletion or later edits. Explicitly handle cancellation before device/release identification. Browser audit is not tamper-proof proof that hardware was flashed.
5. Add emulator tests: unauthenticated/non-admin access denied, denied profile self-promotion, allowed admin metadata edits, denied binary/OTA mutation and client publish/delete, eligible/ineligible recommendation changes and concurrent updates, correct withdrawal/demotion, audit owner/transition/immutability tests, and regression coverage for affected profile flows. Keep both rule copies synchronized after agreeing the source of truth.
6. Determine publisher ADC/IAM requirements and a reliable principal-verification mechanism, with explicit dataloggerdev project/bucket pinning. Admin SDK bypasses Firebase rules; Firebase `users.admin` does not authorize ADC. Send the supported mechanism to FW; do not assume the active gcloud account proves the ADC principal.
7. Ask Hillel to accept or reject bearer-token firmware distribution: token URLs work independently of Firebase Auth/rules. If accepted, record that possession grants downloads; if rejected, agree authenticated USB downloads and the legacy URL implications before integration. Do not claim token links are admin-only.
8. Inspect current bucket CORS, obtain actual hosting origins, and propose a merged config covering required production origins and ScanIn local port 3020 (4200 only if actually used). Preserve existing entries. Prepare explicit deployment commands, scope, verification and rollback plan for approval, not execution.

## Done when / rollout

Return a `kind: feedback` message to `scanin-handbook` and a contract handoff to FW/UI with source-of-truth findings, rules/test results, principal verification, bearer-link decision, exact CORS diff, deployment/rollback commands, and remaining approvals.

Keep implementation separate from production operations. **Do not deploy rules/CORS, alter IAM, grant Lidor/Nathan admin access, publish firmware, send messages externally, or delete/archive old tooling/releases without fresh explicit approval.** After approved setup and publication, Hillel + Lidor must exercise both CP210x and USB-JTAG boards, all three modes, settings preservation/loss, unplug/retry and boot confirmation. Keep the old installer usable until sign-off; deleting GitHub release v2.0.0 is unnecessary and not authorized by this task.
