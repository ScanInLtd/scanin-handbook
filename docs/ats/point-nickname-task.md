# ATS app — Point "nickname" (urgent, today)

> **CANCELLED (2026-10-04):** Nathan keeps a manual list instead. See [`devinci-naming.md`](./devinci-naming.md). Kept for reference.

_To: ATS app team (`scanin-fw-ats-monitoring`). From: Hillel — 2026-10-04._
_Urgent: Nathan is on the DeVinci site now and aims the ATS at every point. Hillel deploys remotely (`redeploy.bat`) as soon as it's ready._

## Why

On DeVinci the point names on the ATS PC don't match the sensor names Nathan sees in the web UI. `A1` on the PC is `A4` in the UI, `C8` is `C12`, `D10` is `D14`, and E–I happen to match. While he aims point by point, Nathan can't tell which UI sensor he's working on. He needs **both names side by side inside the app**, on every screen where a point appears.

This is a quick, safe stop-gap. The full rename feature (stable IDs, cloud sync) is a separate task: `docs/ats/point-rename-task.md`.

## Hard rule

**Do not change `points.point_id`, ever, in this task.** `point_id` builds the MQTT device ID (`topic_for_point()` → `scanin/ATS-5-A1/uplink/samples`), and the cloud routes data by it. A changed `point_id` makes the bridge create a new hidden sensor, and the point disappears from the UI. The nickname is a **display label only**: it never goes into topics, payloads, results, or any lookup.

## What to build

### 1. Data
- `_migrate()`: `ALTER TABLE points ADD COLUMN nickname TEXT` (nullable).
- New append-only table:
  ```sql
  CREATE TABLE IF NOT EXISTS point_nickname_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id     INTEGER NOT NULL,
      point_id    TEXT NOT NULL,
      old_nickname TEXT,
      new_nickname TEXT,
      changed_at  REAL NOT NULL,
      changed_by  TEXT,
      source      TEXT NOT NULL   -- 'manual' | 'import'
  );
  ```

### 2. API (`api/monitoring.py`)
- `list_points` responses include `nickname`.
- `POST /api/points/nickname {point_id, nickname, changed_by}`: set or clear a nickname. In one transaction, update `points.nickname` and insert a history row. Event log, INFO, source `api.points`: `point A1 nickname "" → "A4" by Nathan`.
- `POST /api/points/nicknames/import {lines, changed_by}`: bulk set from text lines `point_id,nickname`. Unknown `point_id`s are reported back, not created. Same history and log per changed row (`source='import'`). Return `{updated, unchanged, unknown[]}`.
- `GET /api/points/nicknames/history?site=…`: list, newest first. Add a CSV download.

### 3. UI (`api/static/index.html`)
- **Show both names everywhere a point appears.** Format: **`A1`** followed by a muted pill **`UI: A4`**. If there's no nickname, show only the name. At least:
  - points table (Monitoring tab)
  - live cycle progress (current point being aimed or measured)
  - cycle detail / results table
  - steer (`/api/goto`) and re-aim (`/api/teach`) confirmations and toasts ("Steering to A1 (UI: A4)…")
  - resection list
  - teach-point dialog
- If the nickname ends with `?`, show the pill in orange with a tooltip: "not verified, check on site".
- Point ⋯ menu → **"Set UI name…"**: a small dialog with the nickname and "your name" fields (remember the last name in `localStorage`).
- Points tab → **"Import UI names…"**: a textarea pre-filled with the list below, then Preview (old → new per row, unknowns in red), then Apply.
- Search/filter box on the points table matches **both** `point_id` and nickname (Nathan will search "C12" and must find `C8`).

### 4. Out of scope
No MQTT/payload change, no cloud call, no change to aim, coordinates, baseline or results.

## Initial nicknames for DeVinci-1 (station 5)

Source: Firestore `ats-device-map` and coordinate matching of each point's data against the UI sensors' history (handbook `ops/src/analysis/ats-points-report.ts`). `?` = not certain, Nathan verifies on site. E4–I11 have the same name on both sides, so they need no nickname.

```
A1,A4
A2,A8
A3,A6
A4,A7
A5,?
A6,A9
A7,A10
A8,A11
A9,A12
B1,B4?
B2,B5
B4,B7
B5,B8
B6,B9
C1,C4
C2,C5
C3,C6?
C4,C7?
C5,C8
C6,C9
C7,C10
C8,C12
C9,C13
C10,C14
D1,D4?
D2,D5
D3,D6
D4,D7
D5,D8?
D6,D9
D7,D11
D8,D12
D9,D13
D10,D14
```

Notes for Nathan (put these in the import dialog's help text):
- `A5`: in the cloud this point is linked to a deleted sensor, so it has no UI name.
- `B1`: its measurements match the **E4** prism's coordinates. B1 is probably aimed at E4's prism.
- `C3` and `C4` both currently write into UI sensor `C6`. One of them is probably `C7`.
- `D1`, `D5`: not confirmed by coordinates.
- `A1`, `A3`, `A6`: the ATS fails to measure them in every cycle (GRC 8710).

## Acceptance

- After deploy, every DeVinci point shows `PC name · UI: name` on all the screens listed above.
- Setting or importing nicknames writes `point_nickname_history` rows and event-log lines.
- MQTT topics and payloads are byte-for-byte unchanged. Check the outbox before and after: same topics.
- The next cycle runs and publishes normally after redeploy.
