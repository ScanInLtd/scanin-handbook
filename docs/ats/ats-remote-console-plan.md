# ATS remote console (web platform) — plan

Status: **proposal, not started** (2026-10-18). Built in phases; each phase is useful on its own.

## Goal

A web-platform page per ATS station that shows what the station is doing — the same picture the
local UI gives on site (cycle steps live, resection, per-point results, health, recommendations,
logs) — so that support (Hillel / Nathan / Didi) can follow and diagnose a station without AnyDesk.
Later: send safe commands from the page to the station.

Motivation: the DeVinci cleanup (14–17.10) and the ATS-6 instrument change (18.10) were diagnosed
with ops scripts (`src/queries/ats-station.ts`, `src/queries/ats-log.ts`) plus AnyDesk screenshots.
The data is mostly already in Firestore; nobody but us can see it.

## Principles

- **The station stays local-first.** The web page is a window and (later) a remote control. The
  station keeps measuring, storing and deciding when the cloud is down.
- **The station has the final say.** Every remote command goes through the same checks as the local
  UI (no cycle running, RMS limits, preview before apply, …). The cloud never writes station state.
- **ATS-specific topics and collections.** The bridge serves many sensor types.
- **Cheap Firestore usage.** Live data overwrites one document; history is bounded.

## What exists today

| Source | Content | Where |
|---|---|---|
| Heartbeat (every 300 s, also during cycles) | online, instrumentConnected, linkOk, activity, cycleRunning, cycleProgress, lastCycleStatus/Ts, lastRmsMm, outboxPending, firmware, nextRunTs | `scanin/{gw}/uplink/status` → `ats_raw_payloads` (`messageType: status`); latest copied to `ats-station-health/{gw}.lastStatus` |
| Station health (every cycle) | cycle summary, quality/held, resection (RMS, refs used/failed/excluded, residuals), per-point status, health checks, open recommendations | `uplink/ats-health` → `ats-station-health/{gw}` + `/cycles/{siteId}_{cycleId}` |
| Events | rebaseline, reference-refound | `uplink/ats-event` → `ats-station-health/{gw}/events/{eventId}` |
| Support logs (on request) | gzip+base64 JSONL chunks, `kind: "ats-log"`, `requestId` | `uplink/ats-log` → `ats_raw_payloads` (`messageType: ats-log`) |
| Samples | per-point displacement, `cycle_id`, `qc_flag`, `matched_point`, `held` | `scanin/{pointDevice}/uplink/samples` → sensors |
| Data-integrity notices | station silent, cycles held, health warning, persistent point issues | existing notices pipeline |

Web platform today: Angular 9 + AngularFire (Firestore SDK 8). `settings/ats-live-status` lists
stations from the last 500 heartbeats in `ats_raw_payloads` (polling, one row per station).

**Not available today:** live logs (only on request), live cycle steps (only the 5-minute
heartbeat `cycleProgress`), a cloud → ATS channel. The bridge already has a downlink pattern for
the ESP dataloggers (`scaninHandler`: `scanin/{deviceId}/downlink/{settings,commands,firmware,…}`,
driven by Firestore listeners, e.g. `esp_datalogger_firmware`), but the ATS doesn't subscribe to
anything yet.

## Phase 1 — Station page from existing data (web only)

No ATS or bridge change.

Route e.g. `/ats/:gatewayId` (and a link from `ats-live-status`). Data: `onSnapshot` on
`ats-station-health/{gw}`, a query on `/cycles` (latest N by `cycle.finishedAt`), `/events`.

Sections:

1. **Header / liveness** — derived from heartbeat + last health:
   - *down* (heartbeat stale > 15 min), *alive, idle* (no cycle, next run at …),
     *measuring* (cycleRunning, progress n/m), *stuck* (cycle running far longer than usual).
   - Software version, instrument connected, outbox pending.
2. **Last cycle** — status, quality, held reason, published count, counts by status.
3. **Resection** — RMS, references used / failed / excluded with residuals; small history chart
   (RMS and per-reference residual over the last cycles).
4. **Points table** — status, displacement, wrong-target / matched point, reason; filter + search.
5. **Health checks** — status, message, suggestion.
6. **Recommendations** — the open to-do list as sent by the station (read-only in this phase).
7. **Cycle history** — list of cycles with RMS / refs / published / held flags; click → that cycle's points.
8. **Events** — rebaselines and re-founds (with applied / missing-sensor status from the Firebase trigger).
9. **Support logs** — list `ats-log` requests for this gateway, decode in the browser
   (gzip via `DecompressionStream` or `pako`), level / text filter, download CSV. Same logic as
   `scanin-handbook/ops/src/queries/ats-log.ts`.

Access: admin / support roles only (Firestore rules on `ats-station-health` and `ats_raw_payloads`).

## Phase 2 — Live cycle progress

**ATS:** forward the progress events the local UI already uses (`engine/cycle.py::_emit_progress`,
collected by `scheduler._on_cycle_progress`) to MQTT, throttled:

- Topic: `scanin/{gatewayId}/uplink/ats-progress`
- Payload (one per step change; coalesce to at most one message per ~2 s):

```json
{
  "siteId": "DeVinci-1",
  "deviceId": "ATS-5",
  "runId": 325,
  "ts": 1792320274.1,
  "event": "step.finished",
  "step": "monitored:A2",
  "verdict": "passed",
  "detail": "68.8012 m",
  "progress": {"done": 34, "total": 72, "stage": "monitored"}
}
```

- Also forward Re-found / fresh-resection / auto re-aim steps (same shape, `runId` = operation id,
  `op: "refound" | "resection" | "reaim" | "cycle"`).
- Best effort, not queued in the outbox: a lost progress message doesn't matter, the cycle result
  arrives through `ats-health`.

**Bridge:** no append-per-message. Write:

- `ats-station-health/{gw}/live/current` — overwritten: current op, run id, stage, done/total,
  current step and sub-step, last update ts.
- `ats-station-health/{gw}/live/steps` — overwritten: the step list of the current run
  (`{step, status, detail}` array of objects — Firestore-safe, no nested arrays), bounded to the plan size.

Cost: ~150 writes per cycle per station.

**Web:** `onSnapshot` on the two docs → the same live step list as the local UI
("ref6: ATR face II…", "h0p10a 73.918 m", "Resection RMS 1.1 mm").

## Phase 3 — Live log tail (on demand)

Two options (decide later):

- **A. On demand (preferred):** a downlink command (phase 4) `logs.stream {minutes: 15, level: "info"}`;
  the station publishes log lines to `uplink/ats-log-live` while the window lasts; bridge keeps a
  ring of the last ~300 lines in one doc. Cheap, only when someone watches.
- **B. Always on, warnings only:** WARN/ERROR lines always published (low volume). No downlink needed.

## Phase 4 — Commands from the web

New channel: `scanin/{gatewayId}/downlink/ats-cmd` (station subscribes) and
`scanin/{gatewayId}/uplink/ats-cmd-ack` (station answers).

```json
{"cmdId": "uuid", "cmd": "cycle.run", "args": {}, "requestedBy": "uid", "requestedAt": 1792320274, "expiresAt": 1792320574}
```

```json
{"cmdId": "uuid", "status": "accepted|rejected|done|failed", "message": "A monitoring cycle is running", "ts": 1792320275}
```

Flow: web writes `ats-commands/{cmdId}` (Firestore) → the bridge (onSnapshot listener, same
pattern as the ESP firmware/settings downlinks) publishes the downlink →
station executes through the same API handlers as the local UI → ack → bridge updates the command doc.

Rules:

- **Allowlist, in stages:**
  1. safe / idempotent: `cycle.run`, `cycle.stop`, `resection.fresh`, `logs.send {minutes}`,
     `logs.stream`, `recommendation.done|dismiss`;
  2. with preview + confirm round trip: `point.autoReaim`, `rebaseline.preview|apply`,
     `refound.preview|apply`, `point.setEnabled`;
  3. never remotely (needs eyes on site): raw steering / typed angles, Teach, manual resection.
- Station refuses commands while a conflicting operation runs; same checks and limits as locally.
- `expiresAt`: stale commands (station offline) are dropped, not executed hours later.
- Idempotent by `cmdId` (station remembers executed ids).
- Audit: every command doc keeps who / when / result; the station logs it in its Event Log.
- Authorization: admin role only (Firestore rules on `ats-commands`); the bridge/function checks again.
- Station can be configured to disable remote commands (`REMOTE_COMMANDS_ENABLED=false`).

## Open questions

- Which roles see the page (admin only vs. project owners read-only)?
- Store support logs in a dedicated collection instead of `ats_raw_payloads` (bridge change already
  listed as a follow-up)?
- Phase 3: option A or B?
- Downlink via the bridge (preferred: it holds the broker connection and already does ESP
  downlinks from Firestore listeners) or a Firebase function with its own MQTT client?
- Should the local UI show "remote viewer connected" / remote command history?

## Related

- `ats-station-health-plan.md`, `bridge-ats-health-handoff.md` — health / event contracts.
- `ats-monitoring-concept.md` — what the station does and why.
- Ops queries: `scanin-handbook/ops/src/queries/ats-station.ts`, `ats-log.ts`.
- Web: `scanin-web-platform/src/app/settings/ats-live-status/`.
