---
title: Firmware & Flashing page — implementation complete, pending FW contract + rules + hardware gates
from: scanin-web-platform
to: scanin-handbook
kind: feedback
status: done-local
created: 2026-11-01T19:00
---

## What was built

Settings → **Firmware & Flashing** (card index 22, route `/settings/firmware`, `AdminGuard` on the child route + adminOnly card), per `docs/firmware-flashing/firmware-release-and-flashing-spec.md` with §10 overrides applied.

### New files (`src/app/settings/firmware/`)

- `firmware.component.*` — tab host (Flash device / Releases)
- `firmware.types.ts` — all contracts (release, parts, `flashLayout` ref, `firmware-release-settings` pointer, `flash-log` entry)
- `firmware-validation.ts` — pure, unit-tested validation: `parts` shape/offsets/alignment/non-overlap/capacity, preserved-range overlap, `flash-layout.json` sidecar parser (`schemaVersion: 1`, sector-aligned erase ranges), on-device partition-table parser, layout compatibility, app-slot probe classification, sha256, error mapping, log redaction, boot-banner parser, metadata-edit allowlist
- `md5.ts` — RFC 1321 MD5 for esptool-js `calculateMD5Hash` on-device verify (verified against vectors)
- `esp-flasher.service.ts` — wraps vendored esptool-js (below): connect/probe (app slot + partition table), `ESP_ERASE_REGION` (0xD1) region erase from layout NVS ranges, whole-chip erase, weighted `writeFlash` + MD5 verify, reset + early boot capture via `rawRead`, monitor re-acquire, cancel flag, idempotent disconnect
- `firmware-release.service.ts` — releases list, `firmware-release-settings/datalogger` pointer (transactional set/clear; clears on withdraw/demotion in the same txn), metadata allowlist edits, `recheckFlashable` immediately before destructive work, downloads with size+SHA-256 verification, audit lifecycle (`result:'started'` before destructive work → one terminal update with `finishedAt`, `bootVerification`, `observedVersion`; identity fields only when genuinely known)
- `flash-device/` — guided 3-step flow (connect/probe → release cards + mode selector → flash/progress/result). Update is enabled only when the installed partition table matches the release layout; unknown/incompatible boards require an explicit replace/clean choice; every erase mode gets a destructive confirmation; failure screen maps errors to plain language + expandable technical log; `beforeunload` warning while flashing
- `firmware-releases/` — table (version/title/channel/star/status/created/commit/size) with edit, set/clear recommended, withdraw/restore, copy bearer links (warns about bearer links). UI never writes `released`, `parts`, `version`, `url`, or git fields.
- `release-edit-dialog/` — title/notes(Markdown w/ preview)/channel only
- `markdown.pipe.ts` — tiny MD renderer; raw HTML escaped, `[innerHTML]` sanitization on top

Changed: `app-routing.module.ts`, `app.module.ts`, `settings.component.ts/.html` (card + index 22 everywhere).

## esptool-js spike result

- **Pinned `esptool-js@0.4.5`** (published Jan 2024, Apache-2.0). Vendored self-contained ESM bundle: `src/assets/vendor/esptool-js/bundle.js` + `LICENSE` + `VERSION.txt` (provenance recorded). No remote/latest script; no npm dep into the webpack 4 bundle.
- Loaded via `new Function('u','return import(u)')` — webpack 4 lacks `webpackIgnore`; only ever loads on this page.
- **Actual API (verified against lib source):** `Transport(port, tracing, enableSlipReader)`; `ESPLoader({transport, baudrate, romBaudrate, terminal})`; `main('default_reset')` → chip name + auto-reset; `chip.readMac(loader)` → eFuse STA MAC, uppercase colon-separated (matches `WiFi.macAddress()` — the ScanIn deviceId); `readFlash(addr,size)` → `Uint8Array`; `eraseFlash()`; `checkCommand('erase region', 0xD1, offset+size)` for NVS erase; `writeFlash({fileArray:[{data,address}], …, eraseAll:false, compress:true, reportProgress, calculateMD5Hash})` — **`data` is a binary string, not Uint8Array**; `hardReset()`; `transport.rawRead(ms)`; `transport.disconnect()`. No `after('hard_reset')` and no `eraseRegion` helper in 0.4.5 — region erase is implemented via `checkCommand`.
- `ng build --prod` under Node 12.22.12 **passes** (only pre-existing budget warnings). The bundle is never parsed by webpack.

## Verification

- `ng build --prod` on Node 12: **pass**.
- `ng test` cannot run repo-wide: **pre-existing broken files** (`mute.api.component.spec.ts` uses `Mute.ApiComponent`; `util-service.service.ts` contains literal `...` placeholders). `firmware-validation.spec.ts` (33 tests — part/offset/overlap/capacity, preserved ranges, sidecar parsing, partition-table parse, layout compat, probe classify, NVS range fail-closed, size/hash failures, error mapping, redaction, boot banner, sorting, metadata allowlist, MD5 vectors) passes when run standalone.
- Mock/emulator-level tests for the Firestore transaction paths and audit finalization are pending emulator availability — flagged for infra coordination below.

## Contract needed from FW (before either side finalizes)

- `flash-layout.json` sidecar schema (v1 implemented): `{schemaVersion:1, chip, flashSize, partitionTableOffset, partitions:[{name,type,subtype,offset,size}], appPartition, nvsEraseRanges:[{offset,size}], preservedRanges:[{offset,size,name?}]}` + `release.flashLayout{path,url,size,sha256}`. A pilot-format `manifest.json` adapter is *not* wired — pilot manifest files map `files[].offset` as hex strings; send a fixture (release doc JSON + sidecar + binaries) to confirm.
- Exact boot banner format — parser expects `ScanIn datalogger fw {version} id {MAC}` (station MAC, uppercase colon-separated).
- Confirm nothing else lives in NVS for the "settings lost" text, and confirm `boot_app0`/otadata behavior on this build.

## Dependencies on infra/security (blocking launch, per §10.1/§10.4/§10.5)

- Firestore rules: admin-only reads on `esp_datalogger_firmware` + `firmware-release-settings`; metadata edit allowlist; singleton pointer `getAfter` validation; `firmware-flash-log` create-by-admin, one terminal finalize by creator, no delete. **The authenticated catch-all currently overrides all of this** — UI guard is the only protection until rules land.
- Storage rules `firmware/**` read-auth/write-deny; bucket CORS for hosting origins + `http://localhost:3020` (merge existing).
- Bearer-token download links: flash downloads use `parts[].url` tokens — needs Hillel's explicit accept/reject decision.
- Emulator tests for recommendation concurrency + audit transitions require rules owner.

## Not done / gates

- **No deploys, no rules changes, no IAM, no releases published, no hardware flashing** — per boundaries.
- Automatic reset and boot capture are unproven on the actual CP210x/USB-JTAG boards; manual BOOT/RESET fallback hint shown only on connection failure. Hardware acceptance pending Hillel's go-ahead.
- Old `scanin-tool-esp-flasher` untouched.
