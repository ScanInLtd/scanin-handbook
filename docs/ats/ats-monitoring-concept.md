# ATS monitoring — the concept, and the rules that keep it correct

_Written 2026-10-11 (Hillel + Devin), after the DeVinci station-5 diagnosis ([`devinci-diagnosis-2026-10-11.md`](./devinci-diagnosis-2026-10-11.md)). Applies to `scanin-fw-ats-monitoring` and to everyone who operates a station (office, field, AnyDesk)._

**Read this before adding, renaming, re-teaching or deleting any point on a station.**

---

## 1. In one paragraph

A robotic total station (ATS) measures angles and distances **from wherever it happens to stand**. To report how a building moves, every measurement must be expressed in one **fixed site frame** — a map that never changes. The map is anchored on **reference points (refs)**: prisms on stable ground whose site coordinates are known. Every cycle, the station measures the refs, works out **where it is standing and how it is turned on the map** (the *resection*, a.k.a. free station), and converts each monitored prism into map coordinates. **Displacement = position on the map now − position on the map at the baseline.** The instrument may move; the refs must not; the map never changes.

This is the standard structure of automated deformation monitoring (free station on a stable control network every epoch, points in a fixed project frame, displacements against a zero reading); commercial systems such as Leica GeoMoS or Trimble 4D Control work the same way. **The concept is right.** What went wrong at DeVinci were (a) operations that silently broke the frame or the baselines, (b) missing quality control, (c) a few missing corrections — all listed below with the rule that prevents them.

---

## 2. Two frames

| | **Instrument frame** | **Site frame** (the map) |
|---|---|---|
| Origin | the instrument | fixed, chosen once |
| Orientation | wherever the instrument's horizontal zero points — **arbitrary**, changes when the instrument is turned, re-levelled, re-set up or its Hz zero is reset | fixed, chosen once |
| Changes when | the instrument moves, rotates, is re-set up | **never** (only by a deliberate, recorded frame re-base) |
| Defined by | the instrument | the **coordinates of the refs** |
| Stored in the DB | raw observations (`observations`) | point coordinates (`points.site_e/n/u`): ref coordinates **and** monitored baselines |

The **resection** is the bridge between them, solved every cycle: a rotation + translation (scale fixed at 1, the EDM is metric) that maps the instrument frame onto the site frame, from the refs' measured positions vs their site coordinates.

> **DeVinci example.** The site was founded on 10.08 with the two frames identical (rotation 0°). On 30.08 the instrument's horizontal zero turned by 88.8° (offset 0 m: the instrument didn't move, it was turned on its base or its Hz zero was reset). Since then every resection reports "rotation 88.79°". **That is normal and harmless** — the resection absorbs it every cycle. It only becomes harmful when somebody stores instrument-frame coordinates as if they were site coordinates (§4.3).

---

## 3. One cycle, step by step

1. **Measure the refs** (two faces, ATR). Each gives a position in the instrument frame.
2. **Instrument steady?** Re-measure the first ref at the end of the set; tilt at start/end. A turning instrument makes the refs disagree → hold.
3. **Resection**: best-fit rotation + translation from the refs' instrument positions to their site coordinates.
4. **Quality gates** (`engine/quality.py`): ≥ 4 refs used (3 have no redundancy — a bad ref can't be detected), RMS ≤ 10 mm (warning > 5), at most one clearly-off ref excluded automatically, no unexplained frame jump vs the last trustworthy cycle. Failing → the cycle is **held**: stored, never published, never used to set baselines.
5. **Monitored points**: aim (taught direction, or predicted from its baseline if the instrument moved > 2°), measure, convert to the site frame with this cycle's resection.
6. **Plausibility per point**: measured vs expected distance and position. Far off → re-measure at the expected position with a narrow ATR window; still off → wrong prism (`wrong-target`), not movement.
7. **Displacement** = site position − baseline.
8. **Cycle-level patterns**: displacement proportional to distance = orientation error → hold. Station health (`engine/health.py`): rotation, stability, reference consistency, prism constant, geometry, swaps, stuck offsets, duplicates, common offset, link.
9. **Publish** only trusted displacements; send the cycle's health to the cloud (`uplink/ats-health`).

---

## 4. Lifecycle operations — the rule for each

| # | Operation | Correct way | Never |
|---|---|---|---|
| 4.1 | **Found a new site** (epoch 0) | Set up, teach ≥ 4 refs (better 5–6), well spread in direction **and** distance (some far, > 50 m), on stable ground, in **one session without touching the instrument**. Their instrument-frame coordinates *become* the site frame (or type surveyed coordinates for all of them). Run 2–3 cycles; check RMS < 2–3 mm before adding monitored points | found refs across several sessions; use refs on the structure being monitored |
| 4.2 | **Add a monitored point** | Teach it (aim only, no coordinates). Its baseline is set by the first **trusted** cycle that measures it, in the site frame. *(Planned: average the first 3 agreeing trusted cycles.)* Check its first displacement values are ~0 | type coordinates by hand unless they are site-frame coordinates; add points while the station is unhealthy (held cycles, RMS > 5 mm, few refs) |
| 4.3 | **Add a reference to an existing site** | **The exception.** Teach only its aim, then **Re-found from current resection**: the station solves its position from the existing refs and gives the new ref site-frame coordinates. Check the measured distance; run a cycle and check its residual is small | **Teach a new reference** (it stores *instrument-frame* coordinates — wrong as soon as the instrument has moved or turned since founding). This broke DeVinci cycle 277 (ref6–8, RMS 19 m) |
| 4.4 | **A reference moved / was replaced** | Station flags it (outlier exclusion, reference consistency). Fix on site if possible; then **Re-found** it from the other refs (≥ 4 others) | keep it in the solve; "fix" it by Re-aim (aim only — its wrong coordinates stay) |
| 4.5 | **Instrument bumped / turned / re-levelled** | Nothing: the next resection absorbs it (health shows `instrument-rotation`). Check the level; watch 1–2 cycles | re-teach points or refs because "the angles changed" |
| 4.6 | **Instrument moved to a new place** | Re-level; make sure ≥ 4 refs are visible; run a cycle — the station predicts the aims from the baselines. If ATR can't find a point, Steer + **Re-aim** (aim only) | re-teach monitored points as new; Teach refs |
| 4.7 | **A monitored point is on the wrong prism** | Steer to the right prism manually, **Re-aim** (aim only). The station's narrow re-measure usually fixes it automatically | delete and re-create it (loses its history and creates a new cloud sensor) |
| 4.8 | **A monitored prism was replaced / moved by people** | Re-baseline that point (§4.10) and note why | let the jump go out as movement |
| 4.9 | **Rename a point** | Not yet safe (the name is the cloud routing key) — see [`point-rename-task.md`](./point-rename-task.md) | rename, or create a second point for the same prism (duplicates: B1 = f4p4) |
| 4.10 | **Re-baseline** (offset is a baseline problem, not movement) | Only when the frame is stable; from ≥ 2 agreeing trusted cycles; the station keeps history and sends a `rebaseline` event so the cloud re-zeroes without an alarm | re-baseline real movement; re-baseline during held / unstable cycles |
| 4.11 | **Frame re-base** (several refs drifted, the map itself must change) | Planned (task §6.3): new ref coordinates **and** every baseline transformed by the same fitted transform, with a dry run and a cloud frame-change event | edit ref coordinates by hand |
| 4.12 | **Disable a reference** | Fine for diagnosis. Keep ≥ 4 active; otherwise every cycle is held | run on 3 refs "for now" |

---

## 5. The rules (short version)

1. **The site frame never changes.** Only a deliberate, recorded frame re-base may change it.
2. **Refs define the frame and must not move.** Place them off the structure, on stable ground, in different directions, some far away. Keep ≥ 4 active; 5–6 is better.
3. **The instrument may move.** That's what the resection is for. Moving or turning it needs no software action.
4. **Instrument-frame coordinates are never stored as site coordinates** — except at founding (§4.1). New refs → Re-found.
5. **A baseline is set only in a trusted cycle** (≥ 4 refs, RMS ≤ 10 mm, no frame jump, no orientation error, instrument steady).
6. **One prism = one point**, forever. No duplicates, no renames until the rename feature exists.
7. **Only trusted displacements reach the cloud.** Held cycles, wrong prisms, stuck offsets and > 100 mm jumps never go out as movement.
8. **Every frame or baseline change is recorded and sent to the cloud** (re-found, re-baseline, later frame re-base).
9. **Don't operate on an unhealthy station.** Add/re-teach/re-found only when the last cycles are trusted and the health card has no red items.

---

## 6. How we compare with standard practice

| Topic | Standard practice | Us |
|---|---|---|
| Fixed control network + free station every epoch | ✔ | ✔ |
| Redundant refs, ≥ 4, good geometry | ✔ | ✔ enforced since release 2 (`few-references` → hold); geometry check |
| Robust outlier handling of refs | least squares + statistical tests | ✔ one automatic exclusion + leave-one-out + consistency history (not a full statistical test) |
| Two faces, ATR | ✔ | ✔ |
| Prism identification | tolerances on expected position, target ID, narrow search | ✔ since release 2: expected distance/position check, narrow ATR re-measure, never save a wrong aim |
| Zero reading | averaged over several validated epochs | ⚠ single trusted epoch (release 2) — **averaging planned** |
| Alarms only on validated data, plausibility, consecutive epochs | ✔ | ✔ since release 2 (held / wrong-target / stuck-offset / too-large never published); cloud smoothing + thresholds |
| Atmospheric correction of distances (temperature, pressure → ppm) | ✔ (met sensor or estimated scale) | ✘ **open** — we saw a uniform −0.6…−1.0 mm on 60 m distances; should be configured / estimated |
| Per-prism constant (prism type) | ✔ | ✘ **open** — mixed prism types would bias distances (R4's change was 100 % along the line of sight) |
| Reference stability checks | periodic network re-observation | ⚠ per-cycle consistency checks; no independent network check yet |
| Adding control points | from the current free station or a network adjustment | ✔ Re-found (single epoch; **averaging planned**) — and Teach for new refs must be **blocked** |
| Instrument mount | pillar / console, monitored tilt | ⚠ health checks tilt and drift; the mount itself is a site matter |
| Audit trail of frame / baseline changes | ✔ | ✔ local history tables + cloud events |

---

## 7. What went wrong at DeVinci, by rule

| What happened | Rule broken |
|---|---|
| R4 moved ~6 cm, kept in the solve for weeks (RMS 23 mm, "PASSED") | 2, 9 — no quality gate then |
| #252 solved from 3 refs, frame 0.24° off, 218 mm "movement" shown green | 2, 5, 7 |
| 13 f-points baselined in cycle 215 (3 refs) → ~100 mm forever; 8 more in 216/234 (RMS 24–26 mm) → ~20 mm | 5, 9 |
| A2 / B1 / D8 / G11 / F11 / I11 / f8p1 on other prisms; wrong aim saved; published as metres of movement | 6, 7 |
| B1 and f4p4 = the same prism | 6 |
| ref6–8 added with Teach → instrument-frame coordinates in a site frame rotated 88.8° → RMS 19 m, cycle 277 lost | 4 |

---

## 8. Open items (software)

1. **Block Teach for a new reference on a site that already has refs** → offer Re-found instead (only allowed on a site with no refs yet). Warn when typing E/N/U by hand.
2. **Baseline from N agreeing trusted cycles** (default 3) instead of one; the point stays "pending baseline" until then.
3. **Re-found averaged over several cycles** (or two Re-founds that must agree) for new refs.
4. **Atmospheric correction**: ppm from a met sensor or the instrument's setting; alternatively estimate scale in the resection when ≥ 5 well-spread refs.
5. **Prism type / constant per point**.
6. **Frame re-base** (task §6.3) for when several refs drift.
7. **Point identity**: rename without changing the cloud identity ([`point-rename-task.md`](./point-rename-task.md)).

---

## 9. Glossary

| Term | Meaning |
|---|---|
| Reference (ref) | stable prism defining the site frame; never on the monitored structure |
| Monitored point | prism on the structure; its movement is reported |
| Site frame | the fixed map all coordinates live in |
| Instrument frame | the instrument's own, arbitrary frame at this moment |
| Resection / free station | per-cycle solve of where the instrument stands and how it's turned on the map |
| Residual | how far a ref is from its site coordinates after the solve; RMS = overall size |
| Baseline (zero reading) | a monitored point's site position at the start; displacement is measured against it |
| Held cycle | measured and stored, but not trusted: nothing published, no baselines set |
| Re-aim | update a point's aim direction only (coordinates / baseline unchanged) |
| Re-found | give a reference new site coordinates from the current resection of the other refs |
| Re-baseline | give a monitored point a new zero from its current stable position (history kept, cloud notified) |
| Frame re-base | change the site frame itself (all refs + all baselines together) — rare, deliberate |
| Wrong target | the instrument measured a different prism than the point's |
| Stuck offset | a constant displacement that comes from a bad baseline, not movement |
