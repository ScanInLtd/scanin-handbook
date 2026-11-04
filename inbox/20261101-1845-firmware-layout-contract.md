---
title: Agree datalogger USB release fixture and safety sidecar v1 before integration
from: scanin-fw-datalogger
to: scanin-web-platform
kind: handoff
status: open
created: 2026-11-01T18:45
---

Please explicitly accept this contract or reply with required changes before finalizing your parser. This is a proposed contract, not yet accepted by UI. No production publish or hardware operation was performed.

## Locally built fixture

`../scanin-fw-datalogger/downloads/esp-firmware/firmware-20261101.1/` contains four real images, unchanged pilot-shape `manifest.json`, `flash-layout.json`, and `release-fixture.json` (Firestore-shaped JSON, dates serialized ISO, download URLs deliberately empty because nothing was published). It is a dirty development fixture, not a recommended/stable release and not evidence of equivalence to deployed firmware. Do not commit/distribute the binaries; existing firmware contains embedded network configuration.

Manifest: exactly `version, commit, date, chip, baud, files[]`. Each file has filename `name`, HEX STRING `offset`, byte `size`, lowercase hex `sha256`. Convert offsets explicitly to integers. Firestore parts mapping: bootloader.bin => bootloader, partitions.bin => partitions, boot_app0.bin => boot_app0, firmware.bin => app. Firestore `parts[].offset` is NUMERIC; references have `path,url,size,sha256`. Validate exact one-to-one filename/name/offset/size/hash mapping. `manifest` release field is an additional reference with the same shape.

`flashLayout: {schemaVersion:1,path,url,size,sha256}` references JSON sidecar. Sidecar v1: `{schemaVersion:1,chip:"esp32s3",flashSizeBytes:8388608,partitionTable:{offset:32768,size:4096},partitions:[{name,type,subtype,offset,size,flags}],appSlot:"app0",preservedPartitions:["nvs","spiffs","coredump"],permittedNvsEraseRanges:[{offset:36864,size:20480}]}`. All numbers are integers/bytes; partition type/subtype are raw numeric ESP partition codes, flags must be zero for v1. Partition-table binary is 3072 bytes (erase-sector reservation 4096), validate its MD5 as well as release SHA256. Derive layout equality from parsed partition entries (including flags), not merely app magic or a version banner.

Actual parsed partitions:

| name | type | subtype | offset | size |
|---|---:|---:|---:|---:|
| nvs | 1 | 2 | 0x9000 | 0x5000 |
| otadata | 1 | 0 | 0xe000 | 0x2000 |
| app0 | 0 | 16 | 0x10000 | 0x330000 |
| app1 | 0 | 17 | 0x340000 | 0x330000 |
| spiffs | 1 | 130 | 0x670000 | 0x180000 |
| coredump | 1 | 3 | 0x7f0000 | 0x10000 |

Four image offsets: 0,32768,57344,65536. Required chip ESP32-S3; capacity >=8MiB. Image header encodes QIO/80MHz/8MiB; use the image header/tool's supported flash settings rather than inventing different values. Validate sector-rounded image erase ranges against preserved partitions. Reject secure boot/flash encryption, encrypted partition flags, unknown security state or unsupported probing; no eFuse changes.

## Preservation/loss: important correction to earlier spec examples

SettingsAdapter persists configuration (network/sensor/calibration/sync state) on SD `/settings.json`, not NVS. SD also holds samples/progress, times, logs, breadcrumbs, streaming crash-loop marker, settings dirty-state files and possible firmware staging file. No application Preferences/NVS/SPIFFS API found. Framework may use NVS for Wi-Fi/cache/calibration state; no hardware inventory was read. Do NOT promise that NVS erase clears datalogger configuration.

Update: exact installed-layout compatibility required in v1; writes erase sectors for four images, reset otadata to app0, preserve nvs/spiffs/coredump and SD. app1 remains but is not selected. Replacement: erase only validated NVS range, and only when installed layout/settings ranges are known safe; retain SD config/data, SPIFFS/coredump and app1. Unknown old layout => no NVS-only replacement until accounted for; fail closed. Clean: entire on-chip flash lost, including NVS, both apps, otadata, SPIFFS/coredump; SD remains and configuration is loaded again on boot. Every NVS/chip erase requires confirmation, even app-probe all-FF.

There are two OTA slots and no factory slot; boot_app0 initializes otadata to select freshly written ota_0/app0. OTA-related code exists but OTA is NOT operational today (Hillel confirmed). Keep released:false and no OTA UI.

## Exact boot/identity contract

New line: `ScanIn datalogger fw {YYYYMMDD.N} id {AA:BB:CC:DD:EE:FF}` followed by LF (UART tool may present CRLF). Regex: `^ScanIn datalogger fw ([0-9]{8}\.[1-9][0-9]*) id ([0-9A-F]{2}(?::[0-9A-F]{2}){5})\r?$`.

Transport is existing Arduino `Serial`, 115200 baud; native USB CDC-on-boot is not enabled in current build flags, so do not assume application banner on every native USB-JTAG port. Emitted immediately after existing Serial.begin + 200ms delay, before existing separator/version logs and before SystemManager, SD, network initialization. Runs each setup, including deep-sleep wake. Hillel approved the additional serial printing; no new delay/network initialization was added. Banner reads ESP_MAC_WIFI_STA directly without starting Wi-Fi; SystemManager uses WiFi.macAddress with the same uppercase colon formatting. Source-level agreement only: ROM readMac vs firmware station-MAC matching and transport visibility on both actual board types remain HARDWARE GATES. Begin capture around reset; writing verified != boot confirmed.

Automatic reset/download depends on actual wiring and pinned esptool implementation. No-buttons operation is not proven on these boards; retain fallback and await approved board tests. Do not borrow the unrelated pilot miniboard's reset capability assumptions.

Recommendation authority: `firmware-release-settings/datalogger.recommendedVersion`, transactional stable + non-withdrawn eligibility. Legacy per-release recommended is false/deprecated. `released` always false.

Please return kind:feedback accepting schema v1 (or exact changes), fixture-validation results, and actual Serial visibility/reset/MAC test plan. Infra approval of ADC verification, IAM, bearer-link distribution, rules and CORS remains pending.
