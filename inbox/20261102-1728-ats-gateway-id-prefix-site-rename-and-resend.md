---
title: Enforce ats- gateway prefix, allow site rename, and add a resend/backfill path
from: scanin-handbook
to: scanin-fw-ats-monitoring
kind: task
status: open
created: 2026-11-02T17:28
---

Context: the new Savyon-office ATS PC was deployed with `MQTT_DEVICE_ID=ats7` (no hyphen). The bridge only routes devices whose id starts with `ats-` to the ATS pipeline (`scanin-svc-mqtt-bridge/src/handlers/scaninHandler.js` — the `deviceId.toLowerCase().startsWith("ats-")` check). Everything else falls into the ESP-datalogger path and is silently dropped:

- `scanin/ats7-*/uplink/samples` → `Empty or invalid samples` (payload has `sensorData`, not a `samples` array) — every cycle's samples lost since the PC came up (~Oct 30).
- `ats-health` / `ats-event` / `ats-log` → `Unhandled uplink message type` — dropped, not even kept as raw payloads. "Send to support" never reaches Firestore.
- `scanin/ats7/uplink/status` → treated as a datalogger status → `Failed to auto-register device ats7` every 5 min (undefined `firmwareVersion`).

So the station measures and publishes fine (cycles ok, "Published N, 0 failed") but is invisible in the cloud. From the PC's point of view everything looks healthy — that's exactly the trap we need to prevent.

## 1. Gateway/device id: enforce the `ats-` prefix

Any of these is fine, pick what fits the setup UI:

- Make the prefix part of the control, not the input: show `ats-` as fixed text and let the user only append characters after it (e.g. `ats-[7]`).
- Or validate on save/connect: warn loudly and refuse to publish if the id doesn't match `^ats-` (the bridge convention).
- Bonus: a startup/connectivity self-check that flags "published OK but unknown to the cloud" (e.g. no ack / unexpected routing) would have caught this whole class of bug.

## 2. Site rename support

Add a way to rename the site from the app, and inform the user about consequences. `siteId` flows into sensor names (`ATS.{siteId}.{pointId}`), `location.site`, `ats-station-health`, and `ats-device-map` routing keys. The current site on that PC is `ats2 יהלום` (space + Hebrew) — it will produce ugly names, so we want to rename it before enabling. Suggest:

- Validate site ids too (ASCII, no spaces) on entry.
- On rename, either keep the old id's history linked or clearly warn that cloud records created under the old id won't be merged automatically.

## 3. Resend / backfill after the fix

Once the id is corrected we want the missed samples (~Oct 30 → now, several cycles already measured) pushed to the cloud rather than lost. Options:

- If the app has a resend/replay for stored cycle results — tell us how to trigger it.
- If the outbox only retains failed publishes (these were accepted by the broker, so presumably not queued), consider a "republish cycle" action or a backfill command we can point at a date range.

Assignment: implement 1 + 2 (UI/validation changes) and answer 3 — either expose an existing resend or spec what's needed. After you ship, the user will update the remote PC over RDP, and we'll verify end-to-end that samples land on `work-sensors` and then map the points (`ats-device-map`) to the existing Navon/Jaffa/Neviim sensors.

Done when: station config enforces `ats-` prefix, site rename is possible with a consequences warning, and there's a documented way to republish missed cycles. Reply with a `kind: feedback` message to `scanin-handbook`.
