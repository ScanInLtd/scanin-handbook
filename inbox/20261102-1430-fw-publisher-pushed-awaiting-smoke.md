---
title: Publisher committed, tagged and pushed; smoke test blocked — no ESP32 board reachable
from: scanin-fw-datalogger
to: scanin-handbook
kind: feedback
status: blocked-hardware
created: 2026-11-02T14:30
---

## Done (per decisions 20261102-1205)

- **Commit + push:** `acbda3e` on `main` — dl-release, publish-firmware.js + tests, banner (src/main.cpp), VERSION/headers 20261102.2, README, recovery doc. Release-owned files only; `platformio.ini`, `go.sh`, `test/`, `.mission/` untouched. Tag `fw-20261102.2` pushed. Side effect: `--tags` also pushed pre-existing local tag `worked-good!` — flag me if you want it removed from origin.
- **UI acceptance:** confirmed via `20261102-1158` (their live parser passes fixture 20261102.2).
- **Bearer links + ADC mechanism:** accepted; implemented as `--bearer-links-approved`/`--identity-mechanism-approved` gates; tokeninfo verified `scanin.link@gmail.com` on the same ADC token.

## Hardware smoke test — BLOCKED, needs hands

`/dev/cu.usbmodem01` exists but esptool sync fails on all reset modes (read-only probes only attempted) and `ioreg` shows **no Espressif device** on this Mac. The datalogger deep-sleeps — even a connected board needs a wake/reset event. This is exactly why the decision assigned Hillel + Lidor hands-on.

**To run the FW-side smoke I need:** an awake board plugged in (press RESET or power-cycle after connecting). Then I'll run: chip/MAC + `get_security_info` (secured devices → stop), partition-table read-back vs release layout, Update-mode write of the four parts (no erase), hard reset, banner capture `ScanIn datalogger fw 20261102.2 id {MAC}`, MAC-vs-ROM equality check. I'll also try serial banner capture on boot.

## Deploy status

Stable+recommended publish remains correctly gated: **not run**, nothing uploaded, no Firestore writes, no IAM changes, no pushes beyond the source commit above. Staged command (post-smoke, clean source, interactive confirm):

`PIO=... ./dl-release --publish --title "…" --notes-file … --channel stable --recommended --smoke-tested --identity-mechanism-approved --bearer-links-approved`

Note: working tree still contains unrelated local changes, so the real publish needs those committed/stashed first (script requires clean source for stable). UI hosting deploy and rules/CORS are other lanes' tasks — not run by me.
