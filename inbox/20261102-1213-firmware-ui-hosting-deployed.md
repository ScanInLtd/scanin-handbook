---
title: Firmware UI committed, pushed and deployed to production hosting
from: scanin-web-platform
to: scanin-handbook
kind: feedback
status: open
created: 2026-11-02T12:13
---

## Authorization and completed operations

Acted on `20261102-1205-firmware-ui-decisions-approved.md` and Hillel's direct request to complete through deployment. Bearer-link acceptance, publisher ADC approval and functions-team rules/CORS ownership acknowledged. Firmware authorization uses `users/{uid}.admin == true`; the firmware route does not accept the legacy `isAdmin` alias. Other existing routes retain their prior authorization behavior.

- Commit: `ea76076` — `feat(firmware): enable validated admin USB flashing in the browser`.
- Pushed successfully to `origin/main` in `scanin-web-platform`.
- Ran the approved `./deploy.sh`: authenticated as `scanin.link@gmail.com`, verified production project `dataloggerdev`, built with Node 12.22.12, deployed hosting with Node 20.19.6.
- Firebase Hosting site/target: `new-scanin-ui`.
- Live hosting version: `b22c32b609610993`.
- Live release: `1793614371942000`; release time `2026-11-02T10:12:51.942Z` (UTC).
- Firmware page: https://new-scanin-ui.web.app/settings/firmware
- Access: sign in as an admin, Settings → Firmware & Flashing. Use Chrome/Edge for Web Serial.

## Committed scope

32 firmware-related files: firmware components/services/validation/tests, route/module/settings integration, scoped canonical-admin guard behavior, focused runner, verification instructions in AGENTS.md, and vendored esptool-js 0.4.5 with license/provenance. No firmware fixture binaries or credentials included.

Unrelated untracked `.mission/`, `docs/mobile-migration-plan.md`, `docs/new-app-migration-plan.md`, and `docs/refactoring/FILE-FOLDER-REORGANIZATION.md` remain untouched and uncommitted. No tracked changes remain after deployment.

## Verification

- Node 12 focused tests with final FW fixture `firmware-20261102.2`: **59 passed, 0 failed**. Original FW wire schema accepted; manifest mapping, artifact hashes/sizes, partition MD5, exact layout including flags, and image headers validated locally without network/hardware operations.
- App typecheck: PASS.
- Focused firmware spec typecheck: PASS.
- Node 12 production build: PASS, independently and again in deploy.sh.
- Existing warnings remain: ngx-multi-window deep imports, esp-dataloggers SCSS budget and initial bundle budgets. No security controls/budgets were bypassed.
- Staged diff whitespace check: PASS.
- Live HTTP smoke checks: `/settings/firmware` returns 200 and references the expected `main-es2015.bca161a0547194c42c2b.js`; that bundle returns 200; esptool VERSION.txt returns 200 with `esptool-js 0.4.5`.
- Served esptool bundle matches the committed Git blob exactly (`6b1c0b143b148010ff6e2ee63b0431f85541c2e8`).

These are build/unit/fixture/HTTP checks, NOT authenticated browser interaction, rules emulator acceptance or physical board acceptance. Repository-wide Karma remains blocked by previously documented unrelated syntax errors.

## Remaining separately owned work (not claimed done)

- Functions/infra team: rules synchronization, emulator verification, deployed rules, bucket CORS and admin grants under `20261102-1205-firmware-rules-contract-decisions.md`. This session did not edit or deploy rules, alter IAM/admin roles, change CORS, or verify that those changes are live. Backend permission failures remain possible until that team finishes.
- Hillel + Lidor / FW: authorized physical CP210x and native USB-JTAG smoke tests, including ROM/station MAC equivalence, banner visibility/reset, update preservation, replacement NVS vs SD semantics, clean and unplug recovery. No boards flashed in this session.
- FW: approved clean-candidate release publication after the physical checks. No firmware was uploaded/published by this session; dirty development fixture remains local and must not be distributed.
- Legacy installer remains available; no retirement action taken.

Important clarification to earlier launch wording: `released:false` is the legacy OTA control, NOT a browser-USB safety lock. The browser uses eligible four-part release metadata, the sidecar/manifest and withdrawal state. Hosting deployment creates no release documents, but an eligible USB release can be flashable even with `released:false`. Do not use that field as evidence that USB flashing is disabled or that physical acceptance is complete. The UI never edits it.

The web-platform commit → push → hosting deployment assignment is complete. Please route this feedback to the FW and functions/infra sessions so their independent acceptance/publication/security work stays coordinated.
