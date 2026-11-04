---
title: Implement admin browser firmware flashing with validated layouts and truthful results
from: scanin-handbook
to: scanin-web-platform
kind: task
status: open
created: 2026-11-01T17:44
---

## Context

Implement Settings → Firmware & Flashing from `docs/firmware-flashing/firmware-release-and-flashing-spec.md` in scanin-handbook. **§10 overrides conflicting earlier examples**, particularly authorization, Update eligibility, recommendation flags, audit rules and success text. Production is dataloggerdev. No OTA and no legacy-tool retirement in this task.

## Assignment

1. Start with a small compatibility spike: pin a vetted esptool-js version, confirm the actual connect/probe/read/erase/write/verify/reset APIs and binary types, and prove `ng build --prod` under Node 12. Use a vendored self-contained bundle if necessary; do not assume the illustrative runtime import works under webpack 4. Preserve dependency provenance/license. Do not load a remote latest-version script.
2. Coordinate the fixture contract with FW before finalizing services: pilot `manifest.json` adapter (hex offsets and filename mapping), Firestore numeric `parts`, `flashLayout` sidecar reference and parsed partitions, exact version/MAC banner. The firmware device ID is Wi-Fi station MAC, not the USB identifier.
3. Add the admin-guarded settings route/card, Flash/Releases tabs, release service/edit dialog and isolated flasher service. UI never creates releases or uploads binaries. Sanitize Markdown. Filter legacy/malformed/withdrawn releases; sort by createdAt. Read `firmware-release-settings/datalogger.recommendedVersion` as authoritative; do not use per-release recommended flags. Transactionally set/clear the pointer with eligible stable releases and clear it on withdrawal/demotion.
4. Validate all files and layout metadata before any erase/write: SHA-256, length, chip, capacity, offsets/alignment/non-overlap, partition bounds and preservation ranges. Parse the installed partition table. An image magic byte does not establish ScanIn compatibility; all-FF at one app offset does not establish an empty chip. Enable Update only for a known compatible layout. For unknown/incompatible boards require explicit mode selection; confirm **every** settings erase and whole-chip erase. Never erase a hard-coded NVS range on an unknown layout.
5. Implement one active flash, withdrawal recheck before destructive work, phase-aware cancellation, port disconnect/re-enumeration handling, navigation warning and reliable lock/stream/transport cleanup. Do not intentionally stop a partially written board because live release metadata changed. Auto-reset depends on hardware wiring; retain manual recovery. Coordinate approved Windows CP210x and native USB-JTAG tests with Hillel.
6. Separate verified writing from boot confirmation. Capture around reset so the initial banner is not lost; only say "running version" after the expected version AND MAC are observed. Otherwise show "written and verified; boot not confirmed" and offer the boot log/retry. Never turn a boot timeout into a false success claim.
7. Implement the revised audit lifecycle in §10.5: `started` before destructive commands, one terminal update by its creator, completion timestamp and separate boot-verification state. For pre-probe/picker cancellation, optional unknown device/release fields must be agreed with infra rather than invented IDs. Failed initial audit blocks destructive work; failed final audit shows a warning and retry without reflashing. Redact secrets/tokens from stored/copied errors and logs. Incomplete browser attempts remain distinguishable from terminal results.
8. Coordinate with infra/security for exact field allowlists, singleton transaction checks and audit rules. Do not independently deploy rules or assume route guards protect Firestore. Keep rules changes with their designated owner to avoid concurrent edits.

## Verification / done when

- Node 12 production build passes and no unsupported modern dependency syntax enters the webpack build.
- Mock tests cover mapping/offset validation, hash/size failures, incompatible/unknown layouts, withdrawal before write, double-click, port loss, cancel phases, cleanup, boot timeout/mismatch, and audit failures.
- Recommendation concurrency and withdrawal/demotion are exercised against emulator rules; non-admin direct-route and data access are rejected once approved rules are active.
- Actual hardware acceptance remains explicitly pending until Hillel approves testing: both board types, Update preserves settings, replacement clears only intended settings, clean install confirmation/loss, unplug/recovery, automatic reset and banner confirmation.
- Send a `kind: feedback` inbox message to `scanin-handbook` with changed files, pinned esptool version/API findings, tests/build output, agreed FW contract, rules dependencies and outstanding hardware gates.

## Boundaries

Local implementation and verification only. **Do not deploy hosting/rules, alter IAM/admin accounts, publish releases, flash hardware, push, or retire the old flasher without separate approval.** No MQTT bridge or pilot modifications. Existing `released` values must never be edited by this page.
