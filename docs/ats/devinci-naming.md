# DeVinci ATS — point naming issue & plan

_Status: 2026-10-04. Site: מגדל דה וינצי דרום (`hmPh7Hg2fjTc9GyNRDYO`), ATS station 5, PC site `DeVinci-1`._

## 1. The issue

The same physical prism has up to three different names, and nothing reliably connects them:

| Where | Example | Notes |
|---|---|---|
| ATS PC point | `C1` | Also the MQTT identity: `scanin/ATS-5-C1/...` |
| Web UI sensor | `C4` | What Nathan and clients see |
| Physical position (Nathan, 2026-10-04) | `f4p6` | **f** = floor, **p** = prism number |

The PC→UI link is the cloud table `ats-device-map/ATS-5-<point>` → `work-sensors/<id>`. On 2026-10-04 it was wrong for 19 of 49 points:

- **16 points** (C1, C6–C10, D1–D9) write into auto-created, **inactive** (hidden) sensors `ATS.DeVinci-1.*`. The UI sensors Nathan watches (C4, C9, C10, C12–C14, D5–D7, D9, D11–D13) have been empty since **2026-08-16**. The data isn't lost; it's in the hidden sensors.
- **C3 and C4** both write into UI sensor `C6` (two prisms mixed in one chart).
- **A5** writes into a deleted sensor. **A2** writes into UI `A8`, but it is on floor 5 (see §3), so A2/A5 are effectively swapped.

Also found:
- **A1, A3, A6** fail to measure in every cycle (GeoCom GRC 8710). **C10** fails most cycles. Reference **R4** has a ~46 mm residual (others 11–15 mm). These are on-site issues.
- 3 readings Nathan thought were "missing" (A12, H11 on 10-03) were stored by the bridge and later **deleted manually** via the chart's "Delete Point" (admin), on 10-04 at 08:19 and 09:01 Israel time.

**Root cause:** the PC point name is the routing key. When points are created or renamed on the PC, the device ID changes and the bridge silently creates a new hidden sensor. Most likely this is what happened around 2026-08-16.

## 2. Nathan's physical names, verified against geometry

Check: same prism number `p` means the same plan position (east/north) on every floor; floor `f` should rise one storey (~3.6 m measured) per step. Tool: `ops/src/analysis/ats-verify-names.ts`.

**43 of 47 names confirmed** (A, C, D, E5–E7, F, G, H, I), within a few cm of their vertical line and on the right floor.

**Open, sent to Nathan on 2026-10-04:**

| PC point | Nathan | Geometry says |
|---|---|---|
| B1 | f4p5 | same vertical line as B2/B5/B6, floor 4 → **f4p4**; f4p5 is E4 |
| B2 | f5p3 | same vertical line as B5/B6 → probably **f5p4** |
| B4 | missing | **f6p4** |
| E4 | missing | **f4p5** |

### Full list (PC point → physical name)

```
A1 f4p1   A2 f5p1   A3 f6p1   A4 f7p1   A5 f8p1   A6 f9p1   A7 f10p1  A8 f11p1  A9 f12p1
B1 f4p4?  B2 f5p4?  B4 f6p4?  B5 f7p4   B6 f8p4
C1 f4p6   C2 f5p6   C3 f6p6   C4 f7p6   C5 f8p6   C6 f9p6   C7 f10p6  C8 f11p6  C9 f12p6  C10 f13p6
D1 f4p11  D2 f5p11  D3 f6p11  D4 f7p11  D5 f8p11  D6 f9p11  D7 f10p11 D8 f11p11 D9 f12p11 D10 f13p11
E4 f4p5?  E5 f5p5   E6 f6p5   E7 f7p5
F10 f10p8 F11 f11p8 G10 f10p9 G11 f11p9
H6 f6p13  H7 f7p13  H10 f10p13 H11 f11p13 H13 f13p13
I10 f10p12 I11 f11p12
```
`?` = waiting for Nathan's confirmation.

## 3. Plan (simple version)

Goal: **one name per prism, the physical name `fXpY`, in the UI**, with every PC point feeding exactly one visible sensor.

1. **Finalize the list** with Nathan (the 4 open rows above).
2. **Don't rename points on the ATS PC.** Renaming changes the MQTT device ID, and the data would go to new hidden sensors again. PC names stay `A1`…; the list above is the permanent PC → physical conversion. Renaming on the PC only becomes safe after the ATS app separates identity from name (`point-rename-task.md`, later and optional).
3. **Fix the cloud mapping** (ops script in the handbook, dry-run first, then apply with Hillel's approval). For each PC point:
   - pick its target UI sensor: the existing sensor that holds this prism's history, matched by coordinates;
   - point `ats-device-map/ATS-5-<point>` at it;
   - move the samples written since 2026-08-16 from the hidden `ATS.DeVinci-1.*` sensor into it (copy, then archive the hidden sensor; never delete);
   - rename the UI sensor to `fXpY` and store the PC point name on it (`atsPointName: "C1"`) so both are visible;
   - resolve C3/C4 (split the shared `C6` by height: C3 = f6p6, C4 = f7p6) and A2/A5 (A2 = f5p1, A5 = f8p1).
4. **Bridge (small change):** unknown ATS device → no silent hidden sensor; log an internal notice so we see new or renamed points immediately.
5. **Verify** with a fresh ATS log export: `ats-points-report.ts` → every row OK.
6. **On site** (Nathan): A1/A3/A6 not measurable, C10 flaky, reference R4.
7. **Process:** agree who may use "Delete Point" on ATS sensors. Prefer marking suspect over deleting.

## 4. Tools (read-only, `./go.sh run …`)

| Script | Purpose |
|---|---|
| `ops/src/analysis/ats-points-report.ts <project> --log=<csv> --html=<out>` | One row per PC point: measured/failed/suspect per cycle, target sensor, visible, coordinate match |
| `ops/src/analysis/ats-verify-names.ts --map=<file>` | Verify a `PC-fXpY` list against geometry |
| `ops/src/analysis/ats-log-vs-db.ts --log=<csv>` | Per cycle: measured on PC vs present in DB |
| `ops/src/analysis/ats-coverage.ts` / `ats-match.ts` | Routing table health; device ↔ sensor coordinate matching |
| `ops/src/analysis/written-between.ts`, `doc-meta.ts` | Firestore write/create times (overwrites, deletions) |

Related: `point-rename-task.md` (proper rename in the ATS app, later); `point-nickname-task.md` (cancelled, since Nathan keeps a manual list).
