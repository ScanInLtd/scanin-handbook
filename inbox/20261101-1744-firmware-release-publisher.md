---
title: Implement datalogger release publishing and agree the flashing safety contract
from: scanin-handbook
to: scanin-fw-datalogger
kind: task
status: open
created: 2026-11-01T17:44
---

## Context

Implement the publishing side of `docs/firmware-flashing/firmware-release-and-flashing-spec.md` in scanin-handbook. Read the full spec, especially **§10, which supersedes conflicting earlier examples**. USB flashing only; no OTA implementation and no changes to the Intel pilot.

## Assignment

1. Inspect your repo instructions, existing `dl-version`, PlatformIO configuration, settings storage, and serial initialization. Reuse the pilot manifest shape as read-only prior art, not its destructive output-directory commands or assumed package paths.
2. Before the UI integrates, send a `kind: handoff` inbox message to `scanin-web-platform` with a locally built fixture: pilot-compatible `manifest.json`, numeric Firestore `parts` mapping, the §10.2 `flash-layout.json` sidecar and its `flashLayout` reference shape, flash requirements, partition entries, permitted erase ranges, exact boot banner and Wi-Fi station MAC formatting. Agree these shapes explicitly; do not let each team invent its own parser/schema.
3. Confirm which settings/data live in NVS, other flash partitions and SD; precisely document loss for replacement versus clean install and compatible-layout requirements for Update. Verify whether this build actually needs `boot_app0` to select app0. Identify secured-device restrictions and board reset capabilities without changing eFuses or touching hardware.
4. Implement root `./dl-release` plus `scripts/publish-firmware.js`: build-only PlatformIO introspection, version bump, **both** version headers, binary embedded-version check, four separate images, unchanged pilot manifest plus safety sidecar, hashes/sizes, title/notes/channel flags, local output, dry-run, and explicit publish confirmation. Never use an upload target to discover offsets. Resolve artifacts from the actual build environment.
5. Pin project/bucket and verify the approved ADC publishing principal using infra's agreed mechanism; no service-account key distribution. Capture source commit/dirty state before generated changes. Commit/tag only release-owned files; preserve unrelated staged work. Record the distinction between source commit and release commit. Do not silently recommend dirty source builds.
6. Publish with create-only Storage preconditions; verify every upload before Firestore `create`. Always write `released: false`. Document partial-publication/resume behavior and report cloud/git/tag phase failures without overwrite or automatic cleanup. Recommended selection uses the transactional singleton pointer in §10.4, not batched flags.
7. Add/confirm the early boot banner `ScanIn datalogger fw {version} id {MAC}` and send its exact timing/transport to UI. Confirm the ROM-tool MAC matches the firmware's Wi-Fi station MAC during approved hardware testing.

## Verification / done when

- Local build and dry-run pass; both version headers match and embedded version is verified.
- Tests cover duplicate version, concurrent create/collision, partial upload, document failure, git/tag failure, invalid identity, malformed layout and unconditional `released: false`.
- The local fixture is accepted by UI; settings-preservation claims are backed by an explicit layout/storage inventory.
- Concise publishing instructions are in your existing README, with recovery instructions in an appropriate existing location.
- Send a `kind: feedback` inbox message to `scanin-handbook` with changed files, exact checks/results, contract handed to UI, blockers, and proposed first stable-release command.

## Boundaries

Implement and verify locally. **Do not publish to dataloggerdev, grant IAM/admin roles, deploy, flash hardware, push, or clean up cloud objects without separate approval.** The first stable/recommended release follows Hillel's approval and an actual board smoke test; it is not an automatic implementation step. Do not claim a rebuild of an old commit is byte-identical to deployed firmware without evidence.
