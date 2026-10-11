# DeVinci station 5 (`DeVinci-1`) — diagnosis, 2026-10-11

_Written 2026-10-11 by Devin with Hillel (call with Nathan and Didi). This is the §0 report of [`resection-quality-task.md`](./resection-quality-task.md), extended with today's live session._
_Plan derived from it: [`ats-station-health-plan.md`](./ats-station-health-plan.md). Implementation feedback: [`../signal-and-alerts/feedbacks/ats-resection-quality.md`](../signal-and-alerts/feedbacks/ats-resection-quality.md)._

---

## 0. Bottom line

1. **Nothing in the data shows real building movement.** Every red point has another explanation: wrong prism, a baseline taken in a bad frame, or a frame offset.
2. **The station has been publishing wrong values to the cloud as real movement** since at least 08.10 — metres on 7 points, ~100 mm on 13 points, ~20 mm on 8 points. The "suspect → confirmed" logic confirms anything that *repeats*, and a wrong prism or a bad baseline always repeats.
3. **R4 is fixed** (re-founded today, 58.5 mm). R1, R2, R3, R5 are consistent with each other to ~2 mm in distance, but R1/R2 sit 6–7 mm off every cycle, and the reference geometry is weak.
4. **The instrument is not stable today**: it turned 28.5 mgon on its base, its tilt jumped 27 mgon in 5 minutes, references and points fail at random, and one ATR timeout desynced the link for a whole cycle.

---

## 1. Sources

| Source | Content |
|---|---|
| Station DB copy `ats-db-2026-10-11.db` (taken 13:0x local, before the release-1 deploy) | cycles 1–272, observations, results, outbox, events (last 5000) |
| Event-log exports from the UI, 2026-10-11 10:26, 10:55, 11:12, 11:20 UTC | re-found attempts, cycles 273–276 (276 partly) |
| Handbook event logs 2026-10-04 and 2026-10-08 | cycles 211–214, 250–253 |
| `scripts/diagnose_cycles.py` (§0 script) and `scripts/replay_qc.py` (release-2 gates, branch `quality-gates`) | read-only analysis of the DB copy |

Times below are local (Israel, UTC+3) unless marked UTC.

---

## 2. Timeline

| When | What |
|---|---|
| 10.08–24.08 | Original points baselined (cycles 2, 10, 34), 5 refs, RMS 0.7–0.8 mm — a good frame then |
| by 03.10 | R4 ~46 mm off in every cycle; RMS 23.4 mm; cycles still "PASSED" |
| 04.10 14:44 | Cycle **215**: only 3 refs (RMS 1.5) — 13 new f-points baselined in it |
| 04.10 15:38 / 06.10 12:26 | Cycles 216 / 234 (R4 wrong, RMS 24–26 mm) — 8 more f-points baselined |
| 08.10 | R4 disabled; #252 from 3 refs → frame rotated 0.24° vs neighbours, monitored up to 218 mm; #253 back with 4 refs at RMS 3.99 |
| 08.10–11.10 08:00 | Stable 4-ref cycles (RMS 4.3–4.6), same residuals every cycle |
| 11.10 08:32–10:09 | Station offline ~97 min (power or PC restart) |
| 11.10 10:12–10:19 | Cycles 270, 271 lose R2/R3/R5 at random |
| 11.10 12:00 | Cycle 272: after one ATR timeout + reconnect, 59 of 61 points fail ("truncated response") |
| 11.10 13:13–13:26 | Cycles 273–275 and the first Re-found attempt: references fail at random (timeouts / ATR "no target"), even with a 50 s timeout; tilt jumps |
| 11.10 13:19–13:45 | Instrument turns −28.5 mgon on its base |
| 11.10 13:39–13:42 | **Re-found R4** succeeds: Δ 58.5 mm from R1, R2, R3, R5 at RMS 4.38 mm; saved, R4 re-enabled |
| 11.10 13:45 | Cycle 276: all 5 refs measured, RMS 5.18 mm, R4 residual 5.4 mm |

---

## 3. Findings

### 3.1 References

| Ref | Distance | Network check (pair distances vs stored coordinates, median) | Residual (4-ref cycles 255–272) | Status |
|---|---|---|---|---|
| R1 | 17.6 m | 2.6 mm | 4.8 mm, constant | consistent in distance, constant offset in the solve |
| R2 | 18.8 m | 1.8 mm | 6.6–7.0 mm, constant | same |
| R3 | 76.6 m | 2.6 mm | 1.4 mm | good |
| R4 | 61.1 m | 54.7 mm (before re-found) | 46 mm in the 5-ref solve, 58 mm predicted from the others | **re-founded today**; residual now 5.4 mm |
| R5 | 17.3 m | 1.9 mm | 2.7 mm | good |

- **R4 change was purely along the line of sight**: measured 61.057 m where the old coordinates imply 61.116 m (−58 mm), direction unchanged. Either the prism moved ~6 cm towards the instrument, or it was replaced / turned and its prism constant differs.
- **R1/R2 constant 5–7 mm**: identical every cycle for a week, so it's a coordinate inconsistency, not noise. In August all 5 refs fitted at RMS 0.7 mm, so something drifted since (a reference moved a few mm, or prism changes).
- **Weak geometry**: R1, R2, R5 at 17–19 m; monitored points at 30–75 m → errors at the references grow ~3.5× at the far points.
- Leave-one-out (5 refs, 211–214): removing R4 drops the RMS 23.4 → 4.5 mm; no other reference behaves like that.

### 3.2 Frame / resection

| Cycle(s) | Refs | RMS | Frame vs previous trustworthy cycle |
|---|---|---|---|
| 211–214 | 5 (R4 bad) | 23.4 | stable |
| 250 | 4 (R3 failed, R4 bad) | 25.1 | 9 mgon / 15 mm |
| 251 | 5 | 23.4 | — |
| **252** | **3** (R4 off, R5 timed out) | 1.8 | **264 mgon / 69 mm (0.24°)** |
| 253 | 4 | 3.99 | 3 mgon / 0.9 mm vs 251 → back in the right frame |
| 254 | 3 (R2 failed) | 1.7 | 13 mgon |
| 255–272 | 4 | 4.3–4.6 | 0.4–4.9 mgon per cycle |
| 276 | 5 | 5.18 | after the R4 re-found |

- #252 is the textbook case: 3 references, a great-looking RMS, and a wrong orientation (A4 66 m → 218 mm, A8 65 m → 214 mm ≈ 3.3 mm/m).
- 4.9 mgon frame wobble between cycles = ~5 mm at 65 m, close to the cloud thresholds (4/6 mm).
- The old log line `rotation=88.79 deg (large values = instrument relocated)` is just the fixed instrument-zero orientation, not a relocation (fixed in release 2).

### 3.3 Instrument

- **Rotation on its base, today**: in cycle 276 every reading (5 refs + 13 monitored checked) is shifted by the same **−28.5 mgon (±0.5)** horizontally vs the median of cycles 260–269; vertical angles ±1 mgon, distances −0.6 … +0.3 mm. R1 Hz had been stable to ±1 mgon all week (21.6543–21.6565°; 276: 21.6302°). Happened between 13:19 and 13:45. The resection absorbs a pure rotation, so results are not affected — but it shows the mount was turned or isn't rigid.
- **Tilt**: normally drifts slowly over the day between −10 and −28 mgon (sun heating). Today: −24 → −11 → +3.4 mgon at 13:13 / 13:15 / 13:18 (cycle starts 2–3 minutes apart).
- **Random failures**: in 15 minutes R1 OK → failed, R2 failed → OK, R3 failed → OK → failed; a 50 s timeout didn't help (Re-found 13:24: R3 timeout 50 s, R5 GRC 8710). A blocked prism would fail every time; a slow search would succeed with 50 s — so the instrument wasn't finding the prisms (moving, or glare).
- **Link desync** (cycle 272): one `AUT_FineAdjust` got no answer in 20 s → reconnect → every following RPC returned "truncated response" → 59 of 61 points failed; the health check reconnected after the cycle. The per-target timeout abandons the worker thread but the instrument keeps executing, so the next target's commands overlap.

### 3.4 Monitored points (cycle 276 + history)

| Group | Points | Displacement | Explanation |
|---|---|---|---|
| **Wrong prism** | A2 (1.19 m), B1 (3.52 m), D8 (7.69 m), G11 (7.68 m), F11 (5.91 m), I11 (3.94 m), f8p1 (7.25 m) | metres, repeating within mm | Measuring another prism. D8 ↔ G11 swapped (f11p11 ↔ f11p9); **I11 reads identical to H11** (286.0657° / 87.1262° / 58.9793 m vs 286.0658° / 87.1259° / 58.9795 m); **B1 reads identical to f4p4** (63.5639 m both) — one prism defined twice; F11 landed on two different prisms within one measurement ("repeat differs by 7242.8 mm") |
| **Bad baseline — cycle 215** | f4p4, f4p7, f5p7, f5p8, f5p10, f5p13, f6p7, f6p10, f8p13 (+ f6p13, f8p6 not measured) | **92–110 mm**, constant | Baselined in cycle 215 (04.10): **3 references**, same failure as #252 |
| **Bad baseline — cycles 216/234** | f4p8, f4p10, f4p14, f6p14, f7p14, f6p8, f7p8, f8p10 | **17–25 mm**, constant | Baselined while R4 was wrong (RMS 24–26 mm) |
| **Original points** | ~40 points A–I | 7–9 mm, constant (±0.3 mm cycle to cycle) | Baselined in August in a good frame; the frame today differs by ~8 mm. Same vector for all points, and it **flipped sign** when R4 was dropped (214: dE +5.7 / dN +5.0 / dU +4.0 mm → 260: −6.1 / −1.2 / −16.1 mm) → a frame offset, not movement |
| **Failed** | B2, C1, E6 (ATR no prism), D1 (positioning GRC 6) | — | Same instrument issue as the references |
| C10 | | V −4 mgon (~3.7 mm vertical at 59 m) in 276 | Watch — could be real or noise |

Raw-reading check (276 vs median of 260–269, after removing the −28.5 mgon rotation): all checked monitored points agree within ~1 mm in distance (uniformly −0.6 … −1.0 mm, likely temperature/pressure) and ±1 mgon vertically → **the building did not move**.

### 3.5 Why the wrong prisms happen

- The prism grid is dense: columns ~3° apart in Hz, floors ~3.4° apart in V (e.g. the A column all at Hz ≈ 264°; f4p7 / f5p7 / f6p7 at 275.95°; f4p10 / f5p10 / f6p10 at 282.8°).
- `AUT_FineAdjust` searches **±0.09 rad ≈ ±5.2°** → ~9 neighbouring prisms inside the window.
- After a measurement the app stored the measured angle as the point's taught aim — **including after a wrong lock** — so the wrong prism became the new aim and the mistake repeated every cycle.

### 3.6 What reached the cloud

Since 08.10 18:00: 728 samples queued, **all published**, on all 61 points. Among them:

| Points | Published displacement | How often |
|---|---|---|
| A2, B1, D8, G11, F11, I11, f8p1 | 1.19–7.69 m | ~every other cycle (2–8 samples each) |
| 13 f-points (cycle-215 group) | 92–110 mm | ~every other cycle (6–7 each) |
| 8 f-points (216/234 group) | 17–25 mm | every cycle (7–15 each) |
| B6 (once), B2 (once) | 15.9 mm / 3416 mm | single samples |

**Mechanism**: a displacement > 20 mm is re-measured; if the repeat agrees it's held as suspect "awaiting next-cycle confirmation"; next cycle, if it's within 3 mm of the held value it's "confirmed" and published with `suspect=false`; the cycle after starts over. A wrong prism or a bad baseline always repeats, so it's always confirmed. Points below 20 mm (the ~20 mm group sits around the limit, the 7–9 mm group below it) are published every cycle without any check.

Open question: what the cloud shows / alerted for these sensors since 08.10 (and whether the manual `ats-setup` baselines absorbed any of the offsets).

### 3.7 Data-model / process issues

- **Duplicates**: B1 and f4p4 are the same prism (identical readings), both active. A5 ↔ f7p14 and B4 ↔ E6 sat within 1–10 mm of each other in 211–214 — check.
- New points were added and baselined in untrustworthy cycles (215 with 3 refs; 216/234 with R4 wrong) — nothing stopped it.
- Point names: old PC names and Nathan's physical names coexist (see [`devinci-naming.md`](./devinci-naming.md)).

---

## 4. Root causes

| # | Cause | Effect |
|---|---|---|
| A | Dense grid + ±5° ATR window + wrong aim saved after a wrong lock | self-perpetuating wrong prisms (A2, B1, D8, G11, F11, I11, f8p1) |
| B | "Confirmed = repeats" logic | wrong prisms and bad baselines published as movement |
| C | Baselines set in untrustworthy cycles (3 refs / RMS 24–26 mm) | permanent ~100 mm and ~20 mm offsets |
| D | Reference network: R4 moved 58 mm (fixed), R1/R2 6–7 mm inconsistent, weak geometry | frame offset ~8 mm vs August; frame wobble up to ~5 mgon |
| E | Instrument/mount not stable today + link desync after timeouts | random failures, whole cycles lost |
| F | No governance of names/points | duplicate definitions, renamed points |

---

## 5. Recommendations

### 5.1 Now (no code)

1. **Stop the junk**: deactivate A2, B1, D8, G11, F11, I11, f8p1 until re-aimed (B1 = f4p4: keep one).
2. **Re-aim** them on site where Nathan can identify the right prism: steer manually onto it, then *Re-aim* (aim only, coordinates kept).
3. **Nathan on site**: instrument mount (today's rotation), R4 prism (moved ~6 cm towards the instrument or replaced?), prism types + the prism constant set in the instrument, line of sight to R2 / R3 / R5, wind / crane / works near the station.
4. **Cloud**: check charts and alerts for these sensors since 08.10; don't delete anything yet.

### 5.2 Release (one deploy, after approval, DeVinci first)

Already on branch `quality-gates`: quality gates (hold on < 4 refs, RMS > 10 mm, frame jump, orientation error; one automatic outlier exclusion), wrong-target re-measure with a narrow ATR window (±0.5°), never saving a suspect/wrong aim, truthful cycle screen, export, replay.

To add (see [`ats-station-health-plan.md`](./ats-station-health-plan.md)):
1. **New confirmation rule**: a repeating displacement is **not** confirmed movement if it lands on another point's position, the distance doesn't match the expected one, it's a constant offset since the baseline, or it exceeds a sanity limit (e.g. 100 mm → operator decision, never automatic).
2. **Don't publish** points flagged wrong-target or stuck-offset until re-aimed / re-baselined.
3. **Re-baseline action** (points, or "all points baselined in cycle X"), with history and a cloud event — replaces the manual `ats-setup`.
4. **Link-desync fix** (reconnect / flush after a timeout before the next target).
5. **Station health checks** + health card + `uplink/ats-health` message + `ats-station-health` collection (bridge team).

### 5.3 Site improvements

- Add a far reference (50 m+) in another direction — the biggest single improvement to the geometry.
- Find what drifted in R1/R2 since August; then re-found or re-base the frame (§6.3 of the task).
- Fix the mount.
- Naming rules: one point per prism; new points only in a trusted cycle (release 2 already blocks baselines in held cycles).

### 5.4 Order

1. Today: deactivate the 7 wrong points; Nathan checks the mount, R4 and prism types.
2. Build the release with the additions above, tested by replay on this DB copy (it contains every pattern).
3. Deploy to DeVinci → watch 2–3 cycles → re-aim the wrong points → re-baseline the offset groups once the frame is stable.
4. Review the cloud history since 08.10.

---

## 6. Reproduce

```bash
cd scanin-fw-ats-monitoring
python3 scripts/diagnose_cycles.py --db <copy.db> --cycles 211-214,250-253 --last 20 \
  --subset R1,R2,R3 --subset R1,R2,R3,R5 --out diag
python3 scripts/replay_qc.py --db <copy.db> --cycles 211-214,250-272   # branch quality-gates
```
