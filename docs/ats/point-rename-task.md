# ATS app — "Rename point" feature (with stable identity & rename history)

> **Status: draft, needs simplification.** A rename option is required, but the default flow must stay simple. Discussion is in [`devinci-naming.md`](./devinci-naming.md) §3.

_To: ATS app team (`scanin-fw-ats-monitoring`). CC: bridge (`scanin-svc-mqtt-bridge`), web-platform._
_From: Hillel — 2026-10-04. Evidence: handbook `ops/src/analysis/ats-points-report.ts` (DeVinci report)._

## 1. Why

Nathan wants to rename the points on the DeVinci station (and later other stations) so that the name on the ATS PC, the name in the web UI and the physical label on the building are **the same**. Today they aren't. On DeVinci, `A1` on the PC is `A4` in the UI, `C8` is `C12`, `D10` is `D14`, and E–I happen to match.

The DeVinci investigation (2026-10-04) found that **16 of 49 points** (C1, C6–C10, D1–D9) send good data that lands in hidden, auto-created sensors `ATS.DeVinci-1.*`, while the UI sensors Nathan watches (C4, C9, C10, C12–C14, D5–D7, D9, D11–D13) have been empty since 2026-08-16. Coordinates prove they are the same physical prisms. Changed point names in mid-August are the most likely cause.

## 2. The core problem: the name *is* the identity

In the ATS app today:

| Where | What uses the point name (`points.point_id`, e.g. `"A1"`) |
|---|---|
| `store/db.py` `points` | `point_id TEXT` + `UNIQUE(site_id, point_id)`: the only identity of a point |
| `results`, `observations` | reference the point by the same text (`point_id TEXT`), not by `points.id` |
| `sync/publisher.py` `topic_for_point()` | MQTT topic `scanin/{MQTT_DEVICE_ID}-{point_id}/uplink/samples`, e.g. `scanin/ATS-5-A1/...` |
| `build_sample_payload()` | `metadata.pointId` sent only on `first_seen` |

In the cloud, the bridge routes every sample by that device ID (`ats-device-map/ATS-5-A1` → `work-sensors/{id}`). **An unknown device ID makes the bridge silently create a new, inactive sensor** `ATS.<site>.<name>`.

So a naïve rename (just editing `point_id`) would:
1. change the MQTT device ID → the bridge creates a new hidden sensor → the point "disappears" from the UI (exactly what we're seeing now);
2. split the point's local history in two (old results stay under the old name);
3. leave no record of what the point used to be called.

Writing it to the log alone doesn't solve this: the event log rotates (the export holds only the last ~1,000 events, about 32h) and can't be queried. A single `old_name` column doesn't either: it loses everything after the second rename and still doesn't fix the routing.

## 3. Proposed design

### 3.1 Separate *identity* from *name* (ATS app)

- Add to `points`:
  - `uid TEXT NOT NULL UNIQUE`: **immutable** point identity, never shown as an editable field.
  - `name TEXT NOT NULL`: display name, editable, `UNIQUE(site_id, name)`.
- **Migration** (in `_migrate()`): for every existing point, `uid = point_id` (freeze the current name as the identity) and `name = point_id`. This keeps every existing MQTT device ID (`ATS-5-A1` …) and every `ats-device-map` entry unchanged. Zero cloud impact on day one.
- New points: `uid` = generated short id (e.g. `p` + 6 base32 chars), never derived from the name.
- **MQTT topic uses `uid`**, not the name: `topic_for_point(uid)` → `scanin/ATS-5-{uid}/uplink/samples`.
- `results` / `observations`: add `point_uid` (backfill from `point_id`); keep `point_id` as "name at the time of measurement" for audit. All history queries go by `point_uid`.
- API/UI: everything that addresses a point (`/api/points/*`, `/api/teach`, `/api/goto`, resection, …) takes `uid`; tables show `name`.

### 3.2 Rename = metadata change + history row

- New table (append-only):
  ```sql
  CREATE TABLE IF NOT EXISTS point_name_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id     INTEGER NOT NULL REFERENCES sites(id),
      point_uid   TEXT NOT NULL,
      old_name    TEXT NOT NULL,
      new_name    TEXT NOT NULL,
      renamed_at  REAL NOT NULL,
      renamed_by  TEXT,          -- operator name typed in the dialog
      reason      TEXT           -- free text, e.g. "align with building labels"
  );
  ```
- `POST /api/points/rename {uid, new_name, renamed_by, reason}`:
  - validates: non-empty, unique within the site, not a reference-point name clash;
  - in one transaction: update `points.name`, insert the history row;
  - writes an event-log entry (`api.points`, INFO): `point <uid> renamed "<old>" → "<new>" by <who>: <reason>`;
  - **enqueues a cloud event** (see 3.3).
  - It must **not** touch aim (`hz_rad`, `v_rad`), coordinates or baseline.
- `GET /api/points/history?site=…` + CSV export button.
- **Points page UI:** a "Rename" item in the point's ⋯ menu → dialog with new name, your name and a reason. Show "previously: A1, A4" under the name when history exists.
- **Bulk rename** (Nathan will do a whole station at once): a "Rename several…" dialog: paste `old,new` lines → preview table (conflicts highlighted, swaps like A1↔A4 allowed because identity is the uid) → apply all in one transaction.

### 3.3 Tell the cloud (keeps the UI and history in sync)

- Every sample payload carries the current name: `metadata.pointName` on **every** message (not only `first_seen`). Keep `metadata.pointId` = uid.
- On rename, enqueue an uplink on `scanin/ATS-5-{uid}/uplink/event`:
  ```json
  { "timestamp": 1790000000, "siteId": "DeVinci-1", "event": "point_renamed",
    "pointUid": "A1", "oldName": "A1", "newName": "A4",
    "renamedBy": "Nathan", "reason": "align with building labels" }
  ```
  It goes through the outbox, so it survives offline periods and is ordered with the samples.

### 3.4 Not a rename: replacing or moving a prism

The rename dialog must say clearly: **"Same physical prism, new name only."** If a prism was replaced, moved, or re-aimed at a different target, that is a **new point** (or a re-baseline). Use "Add point" / "Re-aim" instead. Otherwise we'd glue two different prisms' histories together under one identity. (Cloud side: this maps to the planned *baseline events*, see handbook `docs/signal-and-alerts/plan.md` §4.2.)

## 4. Cloud-side changes (bridge + web-platform)

| Repo | Change |
|---|---|
| `scanin-svc-mqtt-bridge` | Handle `uplink/event` with `event: point_renamed` (today non-sample types only go to `ats_raw_payloads`): append `{oldName, newName, at, by, reason}` to `ats-device-map/{deviceId}.nameHistory[]`, set `currentName`, and set `work-sensors/{sensorId}.atsPointName` plus `atsPointNameHistory[]` |
| `scanin-svc-mqtt-bridge` | On every sample, if `metadata.pointName` ≠ stored `currentName` → update it (self-healing if an event was missed) |
| `scanin-svc-mqtt-bridge` | **Stop silent auto-creation** for ATS: an unknown device ID creates the sensor as `unassigned` *and* raises an internal notice ("new ATS point ATS-5-xxx on DeVinci-1: assign to a sensor"), instead of a hidden `active:false` sensor nobody sees |
| `scanin-web-platform` | Sensor page / ATS live mapping: show "ATS point: A4 (formerly A1, renamed 2026-10-xx by Nathan)"; offer "rename UI sensor to match" (one click) so UI name = ATS name = building label |

## 5. Rollout order (important: don't rename before steps 1–3)

1. **ATS app:** ship 3.1–3.3 (migration freezes current IDs, so it's safe to deploy anytime). Verify on `OfficeTestPC1`: rename a point and confirm it is still published on the same topic, plus a history row and an event message.
2. **Bridge:** handle `point_renamed` + `pointName`; change the auto-create policy.
3. **Ops (handbook, dry-run then apply with Hillel's approval):** repair today's DeVinci mapping. Point the 16 hidden points back at their real UI sensors (by coordinates), resolve A5 (deleted sensor) and C3/C4 (both into C6), and decide whether to move the samples written to `ATS.DeVinci-1.*` since 08-16 into the real sensors.
4. **Nathan renames on site** using bulk rename (agreed list: ATS name = UI name = label). Also on site: A1/A3/A6 not measurable, B1 aimed at E4's prism, reference R4 residual ≈ 46 mm.
5. **Verify:** re-run `ats-points-report.ts` with a fresh ATS log export. Every row should be `OK`, and "ATS" = "UI sensor" = "Should be".

## 6. Acceptance criteria

- Renaming a point does **not** change its MQTT topic/device ID; data keeps flowing into the same UI sensor with no gap.
- Every rename is recorded locally (`point_name_history`, exportable) and in the cloud (`ats-device-map.nameHistory`, `work-sensors.atsPointNameHistory`) with old name, new name, time, who and why.
- A point's local history (results) is continuous across renames.
- Bulk rename handles swaps (A1↔A4) and rejects duplicates.
- Rename never changes aim, coordinates or baseline.
- No new hidden `ATS.*` sensors appear after a rename.
