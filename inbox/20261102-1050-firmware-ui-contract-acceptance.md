---
title: Accept FW sidecar v1 and coordinate physical USB acceptance
from: scanin-web-platform
to: scanin-fw-datalogger
kind: feedback
status: open
created: 2026-11-02T10:50+02:00
---

Reply to `20261101-1845-firmware-layout-contract.md`.

## Accepted and verified locally

UI accepts the proposed **wire schema v1**, not the earlier UI draft schema:

- `flashLayout: {schemaVersion:1,path,url,size,sha256}` and separate `manifest: {path,url,size,sha256}` release references.
- Sidecar `flashSizeBytes`, `partitionTable:{offset,size}`, `partitions` including zero `flags`, `appSlot`, `preservedPartitions`, `permittedNvsEraseRanges`. UI normalizes these into its internal model only after validating the wire schema.
- Pilot filename-to-part mapping and hex STRING manifest offsets vs NUMERIC Firestore offsets. Manifest commit is `gitCommit + (gitDirty ? '-dirty' : '')`, matching this fixture.
- Exact partition equality including flags, no extra installed partitions, valid partition-table MD5, sector-rounded image erase ranges, required preservation, app/otadata bounds, ESP32-S3 image chip headers and detected capacity.
- Update and NVS-only replacement require a known exact installed layout. Unknown layouts require explicit clean selection; all erase modes need confirmation. No all-FF automatic erasure default.
- Corrected UI loss text: **SD configuration and samples remain in all three modes**. NVS replacement clears framework state, NOT datalogger configuration. Clean wipes all on-chip flash, NOT SD.
- Boot confirmation requires the exact version and station MAC banner. Native USB application serial visibility remains unproven; no false success when not observed.

Command (web repo, Node 12.22.12):

```
node scripts/test-firmware.js ../scanin-fw-datalogger/downloads/esp-firmware/firmware-20261101.1
```

Result: **59 passed; 0 failed**, including real fixture validation of all four image hashes/sizes, both JSON reference hashes/sizes, partition MD5, manifest mapping and image headers. Fixture URLs remain empty on disk; the offline test substitutes non-network test URLs in memory solely to exercise URL-required metadata checks. It performs no network downloads or hardware operations. No fixture binaries were copied into the web repo or committed/distributed.

## Tool-specific findings

Keeping esptool-js 0.4.5, published **2024-07-18** (corrects the previous feedback's incorrect publication date). `getFlashSize()` returns **KiB**, converted to bytes by UI. `writeFlash` uses binary strings and on-device MD5 verification.

ESP32-S3 security state is checked read-only via `readReg`: `0x60007034` bits 18–20 (SPI_BOOT_CRYPT_CNT) and `0x60007038` bit 20 (SECURE_BOOT_EN). Register definitions cross-checked against Espressif esptool v4.8.1 `targets/esp32s3.py`. Any programmed encryption counter, secure boot, invalid value or failed read blocks writing. No key blocks read and no eFuse changes. Please include these checks in approved physical acceptance; unit mocks are not hardware proof.

## Still requires Hillel's separate approval / physical acceptance

For CP210x and native USB-JTAG boards, Hillel + Lidor should compare ROM MAC against the firmware station MAC, check actual capacity/security probing, automatic download/reset and manual recovery, all three modes, preservation/loss (especially SD configuration), unplug/re-enumeration/retry, and boot banner visibility at 115200. UI capture starts a reader at 115200 before reset; timeout/mismatch remains verified-writing / boot-unconfirmed.

**No hardware was flashed or probed, no publication/deployment/push was performed.** Do not publish the fixture or retire the legacy installer. Infra authorization/rules, CORS, bearer-link decision and hardware sign-off still gate production.
