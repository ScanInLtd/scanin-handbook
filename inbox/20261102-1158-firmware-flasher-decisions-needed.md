---
title: Firmware flasher ready locally; explicit owner decisions needed before any commit/push/deploy
from: scanin-web-platform
to: user
kind: question
status: open
created: 2026-11-02T11:58
---

## Status

Browser firmware flasher implementation is complete and locally verified in `scanin-web-platform`
(`src/app/settings/firmware/`, vendored `esptool-js@0.4.5`, admin route/card, audit lifecycle).

- Focused suite: **59 tests pass, 0 fail** on Node 12.
- **FW final fixture `firmware-20261102.2`** (original wire sidecar schema per
  `20261102-1300-fw-contract-freeze.md`) **passes** our live parser + all validators:
  `node scripts/test-firmware.js ../scanin-fw-datalogger/downloads/esp-firmware/firmware-20261102.2` → 59/0.
- We **accept the ORIGINAL sidecar contract** (flashSizeBytes, partitionTable{offset,size}, appSlot,
  preservedPartitions, permittedNvsEraseRanges). Acknowledged per `20261102-1303-fw-ui-fixture-verified.md`.
- Freeze concerns already handled in our code: `parsePartitionTable` returns `flags`, layout compatibility
  compares name/type/subtype/offset/size/**flags** exactly, encrypted/nonzero-flag partitions and
  secured/unknown device states are rejected before any destructive command.
- Node 12 `ng build --prod` passes (pre-existing budget warnings only). Nothing committed/pushed/deployed.
- DIO/80MHz/8MiB actual image headers noted; our image-header validation accepts the real headers, not board config.

## Decisions needed from Hillel (explicit yes/no each)

1. **Bearer-token firmware downloads** — accept or reject? Anyone holding a download URL can fetch the
   binaries, independent of Firebase login/roles. Publisher gates on `--bearer-links-approved`.
   (See `20261102-1301-firmware-publisher-approvals.md`.)
2. **Publisher identity mechanism** — approve the proposed ADC scheme? Restricted ADC path, user ADC
   (no service-account keys), same-token Google `tokeninfo` check requiring `scanin.link@gmail.com`,
   `email_verified=true`, pinned project/bucket. Approve/reject; IAM detail goes to infra owner.
3. **Rules/CORS ownership** — confirm the designated infra/security owner will inspect deployed rulesets,
   author synchronized Firestore/Storage rules + emulator tests (contract in
   `20261102-1051-firmware-ui-infra-launch-gates.md`), and merge/approve bucket CORS before launch.
4. **Hardware smoke tests** — approve a session on both board types (CP210x and native USB-JTAG/Serial,
   native board needs CDC-on-boot consideration per FW note) covering: auto reset/download, ROM MAC =
   banner station MAC, banner visibility, update settings preservation, replace (NVS erase, SD survives),
   clean (flash lost, SD `/settings.json` survives), unplug/recovery. No hardware flashed yet.
5. **Commit/push/deploy order** — after the above: approve commit of firmware-related files only
   (working tree has unrelated untracked files), then push, then hosting deploy. Note per FW feedback,
   hosting deploy alone launches nothing — no release is `released:true` and publishing still needs the
   approved `--publish` command with `--smoke-tested` + acknowledgements on a clean, newly built version.

## Reminder

Old Windows installer stays usable until both board types pass all gates. Firmware fixture binaries must
never be committed/distributed (embedded network config). Repo-wide `ng test` remains broken by unrelated
pre-existing files; focused suite is the gate used here.
