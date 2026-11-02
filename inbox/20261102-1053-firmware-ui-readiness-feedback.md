---
title: Review corrected firmware UI readiness and route remaining launch gates
from: scanin-web-platform
to: scanin-handbook
kind: feedback
status: open
created: 2026-11-02T10:53+02:00
---

This corrects/supersedes the readiness claims in `20261101-1900-firmware-flasher-feedback.md`. Local code/build verification is not production or hardware acceptance. Hillel requested fixes before the conditionally authorized commit/push/production deployment; those operations have not been performed because launch gates remain open.

## Fixes made

- Metadata demotion and withdrawal transactions now read all documents before any write. Pointer clearing stays in the same transaction.
- UI accepts the actual FW v1 sidecar wire schema and pilot manifest hex filename/offset mapping, including dirty commit suffixes. Real fixture successfully validated without copying or distributing its binaries.
- Installed/release partition tables require valid MD5 and exact entry equality including flags; no partial-prefix or extra-partition compatibility. Reject encrypted flags, invalid partitions, overlaps, missing preservation and unsafe NVS ranges.
- Validate chip, detected capacity (esptool-js 0.4.5 returns KiB, converted to bytes), sector-rounded write/erase ranges, app/otadata bounds, and ESP32-S3 image headers. NVS replacement requires a known matching installed layout. All-FF app probe no longer chooses clean install automatically.
- Read-only S3 security-register checks reject secure boot, programmed encryption state, invalid/unknown values or failed reads before destructive commands. Definitions sourced from Espressif esptool v4.8.1; no key blocks read and no eFuse changes. Physical validation remains pending.
- Re-fetch eligibility from the server at the last pre-destructive boundary, reject changed artifacts, and do not intentionally abandon a partial write when cancellation/metadata changes arrive during writing.
- Initial audit failure blocks writes. Creator-only terminal transaction, immutable identity fields, read-only acknowledgment retry, retained finalization payload, redaction and retry without reflashing. Device/release IDs are never fabricated.
- One UI/service operation lock, including double-click and confirmation dialog; settings breadcrumb navigation is blocked before it can destroy the inline flasher. Added router deactivation guard and strict canonical-admin mode for the firmware route (other routes' legacy behavior unchanged).
- Boot capture reconnects at 115200 and starts reading before reset, with exact banner parsing and no boot-confirmed success on timeout/mismatch. Closed-port monitor reference retained for explicit monitoring after cleanup; actual USB re-enumeration behavior still requires physical acceptance.
- Corrected loss text: NVS erasure does NOT reset SD-based datalogger configuration; all modes retain SD configuration/samples. Clean destroys all on-chip contents. Every erase is confirmed.
- Registry/recommendation filtering tightened, recommendation badge/pinning compares version identity rather than object references. Withdrawal reason required and bounded.

## Changed files

Existing app integration: `src/app/app-routing.module.ts`, `src/app/app.module.ts`, `src/app/guards/admin.guard.ts`, `src/app/settings/settings.component.ts/.html`.

Feature: `src/app/settings/firmware/` (types, validation, MD5, release/audit service, esptool service, navigation guard, Flash/Releases components, metadata dialog, sanitized Markdown pipe).

Tests: `scripts/test-firmware.js`, `firmware-validation.spec.ts`, `firmware-readiness.spec.ts`, synthetic `firmware-test-data.ts`. Vendored esptool-js remains unmodified 0.4.5; `VERSION.txt` records corrected publish date, units and security-register source. No FW binaries added to the repository. Unrelated pre-existing untracked work left untouched.

## Verification results

Node **12.22.12**:

```
node scripts/test-firmware.js ../scanin-fw-datalogger/downloads/esp-firmware/firmware-20261101.1
```

**59 passed; 0 failed** using the repository's real Jasmine 3.4, with Angular/transport/Firestore mocked for unit tests. Includes one real local fixture artifact-validation test, not hardware or emulator testing. The test-only Node SHA-256 adapter uses native crypto; production uses browser Web Crypto.

Both focused spec TypeScript checking and `tsc -p tsconfig.app.json --noEmit` pass.

`ng build --prod` under Node 12 passes; final hash **b045311f436302325c4e**, build time 151351ms. Existing bundle/style-budget and ngx-multi-window warnings remain. No security/build configuration was relaxed. Repository-wide Karma remains blocked by the previously identified unrelated broken legacy files; the focused runner is committed-source-ready and reproducible, not a temporary assertion shim.

## Route these handoffs

- FW: `20261102-1050-firmware-ui-contract-acceptance.md` — schema acceptance, fixture result, exact USB/MAC/banner/reset acceptance plan.
- Infra/functions owner, coordinating with Hillel: `20261102-1051-firmware-ui-infra-launch-gates.md` — exact metadata/pointer/audit allowlists, rule/emulator/caller-identity agreement and CORS/bearer dependencies. Do not launch a competing catch-all rewrite.

## Still blocking production

1. Owner-approved, emulator-tested authorization rules and deployed-state/source-of-truth verification (both catch-all and profile self-promotion paths). UI guard is not Firestore authorization. No rules were edited/deployed here.
2. Hillel's explicit bearer-token download acceptance/rejection; actual bucket/origin CORS inspection/merge and separately approved rollout.
3. Hillel-approved CP210x + native USB-JTAG physical acceptance: security/capacity/MAC, all modes and actual preservation/loss, unplug/re-enumeration/retry, automatic/manual reset, and boot-banner visibility. No hardware operations were performed.

**No commit, push, hosting/rules/CORS deployment, production writes, IAM changes, firmware publication, fleet/OTA/pilot changes or legacy-tool retirement.** Existing `released` values are never edited by this feature.
