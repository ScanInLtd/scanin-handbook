---
title: FW publisher ready; five explicit decisions requested before launch
from: scanin-fw-datalogger
to: user
kind: question
status: open
created: 2026-11-02T14:00
---

## Status (short recap)

USB firmware publisher is implemented and locally verified: `./dl-release` + `scripts/publish-firmware.js`, approved boot banner line, storage/loss inventory, recovery docs, 16/16 tests passing, fixture `firmware-20261102.2` accepted by the actual UI parser. Nothing published, flashed, deployed, committed or pushed. Details in `20261102-1302-firmware-publisher-feedback.md`; approvals detail in `20261102-1301-firmware-publisher-approvals.md`.

One key finding already handed to UI: **datalogger settings live on SD `/settings.json`, not NVS** — NVS/whole-chip erase does not factory-reset the device's configuration; SD data survives every flash mode.

## Decisions needed (please answer each)

1. **Commit & push the implementation?** All changes are local/uncommitted (script, tests, banner, VERSION bump to 20261102.2, README/docs). Approve a `Release firmware` commit + tag `fw-20261102.2` + push to main, or should I commit differently? Unrelated local work (go.sh, platformio.ini, test/ probes) stays untouched.
2. **Bearer download links — accept or reject?** Published releases get tokenized Storage URLs; anyone holding a link can download, regardless of Auth/rules. The publisher refuses to publish without your recorded acceptance (`--bearer-links-approved`).
3. **ADC principal verification — approve the mechanism?** Same-token tokeninfo check requiring `scanin.link@gmail.com` (verified locally; no gcloud-auth-list inference, no service-account keys). Also confirm the actual IAM that account has/needs (Storage create/read/list + Firestore create/transaction; no deletes).
4. **Hardware smoke test — authorize scheduling?** Both CP210x and native-USB boards: connect/probe, MAC equality (ROM vs station MAC), auto-reset, Update preserving settings, Replace/Clean semantics, banner capture, unplug recovery. Until this passes, no stable release and no no-buttons claim.
5. **UI contract acceptance.** My integration test shows the UI parser accepts the fixture; I asked UI to reply explicitly (`20261102-1303-fw-ui-fixture-verified.md`). Please confirm their reply is the remaining blocker before first real release — or if you waive it.

Rules/CORS deployment stays with the infra owner (`20261101-1744-firmware-infra-security.md`); the admin card is not a security boundary until rules land. First stable/recommended publish command is staged only after decisions 1–4 plus a clean-source build of the actual firmware under test.
