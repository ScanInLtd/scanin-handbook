---
title: USB firmware publisher locally verified; final fixture passes live UI parser; publication gated
from: scanin-fw-datalogger
to: scanin-handbook
kind: feedback
status: open
created: 2026-11-02T13:02
---

## Local implementation

Changed/added: executable root dl-release; scripts/publish-firmware.js; scripts/publish-firmware.test.js; firmware/esp32/src/main.cpp (approved serial banner only); firmware/esp32/VERSION and BOTH version headers (20261102.2 from local dry-run); README.md (concise publish instructions + consult Hillel before runtime changes/battery constraints); docs/firmware-download-structure.md (current contract, storage/loss inventory, approval and partial-failure recovery; legacy format retained below).

Unrelated pre-existing README go.sh line, platformio.ini changes, test/ probes, go.sh, .mission/ were preserved. No pilot, bridge, UI, IAM/rules or legacy flasher changes by FW agent. No repository commit/tag/push, production writes, deployment or hardware operations. Tests create/commit/tag only in a disposable temporary test repository, not the real repo.

Publisher: explicit local/default/dry-run, version bump, matching headers and embedded-version check, build-only PlatformIO idedata with actual resolved extra image paths/offsets, four separate images, pilot manifest unchanged, partition MD5/parsed layout validation and sector-rounded preservation checks, image chip/capacity check, numeric Firestore parts, hashes/sizes and sidecar reference. Metadata supplied by --title/--notes-file/--channel (flag-driven workflow; no editor integration). Captures full source commit/branch/dirty BEFORE version generation; dirty requires --allow-dirty and cannot be stable/recommended. Cloud requires explicit --publish and approval acknowledgements; pinned project/bucket and same-ADC-token verified-email check, create-only Storage generation preconditions, generation-specific download/hash verification of all six objects before Firestore create. released:false unconditional. Transactional singleton recommendation. Successful cloud phases followed by release-only git commit and annotated tag, preserving unrelated index entries; sourceCommit differs explicitly from local releaseCommit in phase report. Partial prefixes never reused/overwritten/cleaned; supported recovery is a new version, not automatic resume. Ambiguous timeout operations require read-only inspection. Git/tag failure never republishes.

## Exact checks/results

- Baseline and updated main PlatformIO build: PASS. Latest command: `./dl-release --dry-run --allow-dirty --version 20261102.2 --title "Final USB contract fixture" --pio /Users/hillelvidal/Library/Python/3.9/bin/pio`: PASS, all local only. Existing Python LibreSSL, ignored test src_dir and ArduinoJson deprecation warnings remain.
- `node --test scripts/publish-firmware.test.js`: 16 PASS, 0 FAIL, 0 SKIP locally (Node26.5.0; implementation uses Node>=20 APIs). Covers duplicate document version, concurrent create collision, partial upload, hash-verification failure, document and recommendation failure, git/tag failures, invalid ADC identity, malformed layouts/partition binary, released:false, numeric counter >9, real temporary-git preservation of unrelated staged work, actual fixture hashes/layout/version/boot selector, and actual sibling UI parser/parts/preservation/installed-table compatibility acceptance.
- `git diff --check`: PASS.
- Read-only OAuth tokeninfo POST: verified email scanin.link@gmail.com, email_verified=true, token valid. This is verification of proposed mechanism, NOT infra IAM/production authorization acceptance. Cloud SDK paths are pinned because google-auth-library ignores CLOUDSDK_CONFIG for well-known ADC lookup.
- No live cloud publish/failure injection was run; cloud orchestration failures are mocked. No claim of deployed-rules validation or hardware MAC/reset/security testing.

## Contract / fixture to UI

Original wire schema from inbox/20261101-1845-firmware-layout-contract.md remains authoritative: flashSizeBytes, partitionTable{offset,size}, appSlot, preservedPartitions (names), permittedNvsEraseRanges. UI was observed updating its parser to this original shape while FW briefly tried old UI-internal field names. Final fixture `../scanin-fw-datalogger/downloads/esp-firmware/firmware-20261102.2/` uses ORIGINAL schema and passes the ACTUAL current sibling UI parser/part validator plus parsed installed-table compatibility test. Intermediate 20261102.1 is NOT for integration; no existing local folders were deleted/overwritten. This parser test is not a human/team acceptance reply: explicit UI acknowledgement still pending. Freeze message: inbox/20261102-1300-fw-contract-freeze.md.

Part offsets/sizes: bootloader 0/15104; partitions 32768/3072; boot_app0 57344/8192; app 65536/2206080. App SHA256 81456a2d9b49898d8f3cd5a9cd8264339f1f3f8208dca11df48a758e15790d1e. Actual app+boot headers DIO/80MHz/8MiB, NOT board-config QIO. boot_app0 first sector sequence1, second sequence0; dual OTA/no factory layout means app0 selection initializer required; physical proof pending. OTA-related code exists but Hillel confirms it does not work operationally today; no OTA changes.

Approved banner exact line `ScanIn datalogger fw {version} id {UPPERCASE:COLON:STA:MAC}` with real six-byte MAC, LF, existing Serial115200 after existing200ms delay before SystemManager/SD/network. esp_read_mac(ESP_MAC_WIFI_STA), no Wi-Fi startup/new delay. On every setup including deep-sleep wake; Serial.flush included. MAC equivalence to actual ROM-tool readMac and Serial visibility on native USB port remain board acceptance gates, not asserted. Native USB CDC-on-boot is not enabled by current flags.

Storage: datalogger configuration/calibration/network state is SD /settings.json; logs/samples/progress/timers/dirty-state/streaming marker also SD. No app Preferences/NVS/SPIFFS calls found; framework NVS may hold Wi-Fi cache/calibration. Update preserves compatible NVS/SPIFFS/coredump and SD; replacement adds only validated compatible NVS erase, NOT SD settings reset. Clean loses all flash but SD config/data survives and reloads. Unknown old-layout settings ranges => no guessed NVS erase. Source inventory and exact partition table are documented. Every NVS/whole-chip erase needs confirmation. Security state/actual reset wiring not touched.

## Remaining gates and proposed first stable command

Infra question: inbox/20261102-1301-firmware-publisher-approvals.md. Need approved exact ADC mechanism/IAM, bucket/rules/CORS readiness, Hillel acceptance of bearer-token distribution. Need explicit UI contract acceptance and actual approved CP210x/native-USB smoke tests (MAC equality, transport/banner, auto-reset, compatible update preservation, NVS loss vs SD retention, clean/unplug recovery). No rebuild equivalence claim for historical production firmware. UI hosting deployment alone satisfies none of those gates.

After code/source review and clean commit (including review of generated local version changes), approvals and actual-board smoke test, proposed operator command (NOT executed):

`PIO=/Users/hillelvidal/Library/Python/3.9/bin/pio ./dl-release --publish --title "First approved USB release" --notes-file /path/to/reviewed-notes.txt --channel stable --recommended --smoke-tested --identity-mechanism-approved --bearer-links-approved`

Keep interactive final confirmation; verify the exact newly built candidate artifacts on the approved board before accepting publication. Do not treat an earlier/different build's smoke test as binary-equivalent proof. No --yes recommendation for first release. This builds a NEW unique version, not the dirty development fixture. Local-only implementation is ready; production launch is deliberately not claimed complete.
