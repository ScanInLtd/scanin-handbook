# ATS — IDs & naming (discussion)

_Status: **DRAFT for discussion** (Hillel, 2026-10-04). Applies to every ATS station, not only DeVinci. The DeVinci case that triggered it is in [`devinci-naming.md`](./devinci-naming.md)._

## 1. Requirements

- **Simple by default:** one name per prism, the same on the ATS PC and in the UI; every ATS point feeds exactly one visible sensor; nobody needs to understand mappings in normal work.
- **Rename is supported:** renaming a point must not break the data flow, create duplicate or hidden sensors, or lose history; the old name stays traceable.
- **History is never lost** when points are renamed, re-created, re-taught or moved between stations.

## 2. How it works today (all stations)

```
ATS PC point "C1"  ──►  MQTT scanin/ATS-5-C1/uplink/samples  ──►  bridge
   (points.point_id)        (MQTT_DEVICE_ID + "-" + point_id)        │
                                                                      ▼
                                   ats-device-map/ATS-5-C1 → work-sensors/{id}   (single current pointer)
                                   fallback: work-sensors.atsDeviceId == "ATS-5-C1"
                                   unknown → auto-create sensor "ATS.<siteId>.<point>" (inactive, hidden)
```

| Concept | Identity today | Where |
|---|---|---|
| Station | `MQTT_DEVICE_ID` env on the PC (`ATS-5`, `ATS-6`, …) | ATS PC |
| ATS site/job | free-text site name on the PC (`DeVinci-1`), sent as `siteId` | ATS PC → payload |
| Point | its **name** (`point_id`, e.g. `C1`), also the MQTT device ID suffix | ATS PC |
| Sensor (UI) | Firestore doc ID; editable `name` | cloud |
| Point → sensor link | `ats-device-map/{ATS-<station>-<point>}.sensorId`, no history | cloud |
| Email-ingested ATS (Hexagon) | `scanin-id` like `PRISM%ATS5%A12` | cloud (separate path) |

## 3. What goes wrong

1. **The name is the identity.** Renaming or re-creating a point on the PC produces a new device ID, so the bridge auto-creates a new hidden sensor and the data "disappears" from the UI. DeVinci: 16 points since 2026-08-16.
2. **No link history.** `ats-device-map` holds only the current target, so "which point fed this sensor in August?" can't be answered.
3. **Silent auto-creation.** New or unknown points become `active:false` sensors nobody sees.
4. **No consistency check.** Two points can feed one sensor (DeVinci C3/C4, NAVON-area `h2p5b`/`h2p5d`), and points can target deleted sensors (DeVinci A5, `ATS-6-h0p11b`, `h2p5a`, `h3p1a`).
5. **Three naming schemes:** PC name, UI name, physical label (e.g. Nathan's `f4p6`), with nothing tying them together.
6. **Site binding is free text:** the PC `siteId` isn't a project ID.

## 4. Options for rename (to discuss)

| | Option | How a rename works | Default flow | Main risk |
|---|---|---|---|---|
| **A** | **Hidden stable ID on the PC, name is a label** | PC keeps an internal point ID that never changes (existing points: frozen = current name, so nothing changes in the cloud). Rename only changes the label; every message carries the label; the cloud shows it and keeps the history | Rename in one place (PC); UI name follows | ATS app change + small bridge change |
| **B** | Name stays the key; rename sends an event | PC sends `point_renamed(old→new)`; bridge moves the mapping | Same for the user | Fragile: missed or out-of-order events, outbox replays with old topics |
| **C** | Never rename on the PC; rename only the UI sensor | PC names are fixed forever; UI sensor renamed freely | Simplest technically | Two names forever; confusing on site |

Detailed draft of option A: [`point-rename-task.md`](./point-rename-task.md) (too heavy as written; to be simplified).

## 5. Open questions

1. Who **owns** the name: the PC (and the UI follows), or the UI (and the PC follows)?
2. Should the UI sensor name follow the PC name **automatically** after a rename, or only on request?
3. A **naming convention for all sites** (e.g. `f<floor>p<prism>`)? Who assigns it, and when (at installation)?
4. **New point on the PC:** auto-create a *visible* sensor in the right project, or put it in an "unassigned" list for someone to confirm?
5. **Re-taught / replaced / moved prism:** new point, or the same point with a new baseline? Who decides, and where?
6. **Station identity** when an ATS moves between sites: does `ATS-5` stay `ATS-5`? How is the station bound to a project?
7. Should email-ingested ATS (Hexagon, `PRISM%ATS…`) and live ATS converge on the same naming?
8. Who may **delete** samples on ATS sensors (see the DeVinci manual deletions)?
