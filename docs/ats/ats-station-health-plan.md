# ATS station health — plan (one deploy with the quality gates)

_Repo: `scanin-fw-ats-monitoring` (+ bridge team for §4) · Written 2026-10-11 (Hillel + Devin) · Status: **implemented on branch `quality-gates`, not deployed** — bridge message: [`bridge-ats-health-handoff.md`](./bridge-ats-health-handoff.md)_
_Context: [`resection-quality-task.md`](./resection-quality-task.md), feedback in [`../signal-and-alerts/feedbacks/ats-resection-quality.md`](../signal-and-alerts/feedbacks/ats-resection-quality.md)._
_Don't deploy to a station PC without Hillel's approval. DeVinci station 5 first._

---

## 1. Why

On 2026-10-11 we diagnosed DeVinci station 5 from a copy of its DB (cycles 211–276) and live logs. Every problem we found has a clear signature in the data, so the station can detect it by itself each cycle, instead of us finding it by hand:

| What we saw | Signature in the data |
|---|---|
| Instrument turned on its base by **−28.5 mgon** between 13:19 and 13:45 | every point (refs + monitored) shifted by the same Hz angle, V and distance unchanged; R1 Hz had been stable to ±1 mgon all week |
| Instrument not stable (refs failing at random, ATR "no target") | tilt at cycle start jumped −24 → −11 → +3 mgon within 5 minutes; normal daily range −10 … −28, slowly |
| R1 / R2 residuals 4.8 / 6.6 mm, identical every cycle for a week | constant residual = coordinate inconsistency, not noise (in August all 5 refs fitted at RMS 0.7 mm) |
| R4 re-found: 58.5 mm change, **all along the line of sight** | distance 58 mm shorter, direction unchanged → prism moved towards the instrument, or prism type/constant changed |
| Points on another point's prism every cycle: D8 ↔ G11 swap, F11, I11 (metres) | measured position = another point's baseline, repeats within mm |
| A2 1.19 m, B1 3.52 m off, every cycle since 04.10 | huge displacement that repeats within a few mm = wrong prism or wrong baseline, not movement |
| **13 f-points ~92–107 mm**, all baselined in cycle 215 (04.10, **3 refs**, RMS 1.5) | constant offset since baseline; baseline taken in an untrustworthy frame (same failure as #252) |
| **8 f-points ~17–25 mm**, baselined in cycles 216 / 234 (04–06.10, R4 wrong, RMS 24–26 mm) | constant offset since baseline; baseline taken in a bad frame |
| **~40 original points 7–9 mm**, baselined in August (good frame then) | same vector for all points, stable ±0.3 mm cycle to cycle, and it **flipped sign** when R4 was dropped (214: dE +5.7 / dN +5.0 / dU +4.0 → 260: −6.1 / −1.2 / −16.1) → a frame offset, not building movement |
| Weak geometry: R1, R2, R5 at 17–19 m, monitored points at 30–70 m | errors at the references are multiplied ~3.5× at the far points |
| 12:00 cycle: 59 of 61 points failed | after one ATR timeout + reconnect, every following RPC returned "truncated response" (link desync) |

Today the cloud only sees "a displacement". The goal: every one of these becomes a named, stored, published **station health item** with a suggested fix, so false alarms are avoided and the station can be brought to a steady state item by item.

---

## 2. Scope — one deploy

| # | Item | Status |
|---|---|---|
| 1 | Quality gates (few-references / bad-resection / outlier exclusion / frame-jump / orientation-error → hold), wrong-target re-measure with a narrow ATR window, truthful cycle screen, cycle export, `replay_qc.py` | ✅ done on branch `quality-gates`, replayed on the DeVinci DB |
| 2 | Link-desync fix | ✅ |
| 3 | Station health checks (§3) | ✅ |
| 4 | Health card in the UI + per-point "stuck offset / swapped / duplicate" badges | ✅ |
| 5 | MQTT `uplink/ats-health` message per cycle (§4) + `uplink/ats-event` (re-baseline, re-found) | ✅ |
| 6 | Extra fields on samples (`qc_flag`, `matched_point`, `held`, `cycle_id`) | ✅ |
| 7 | Re-baseline action for points with a stuck offset (§3.9) | ✅ |
| 8 | Tests: unit + simulator + replay of the health checks on the DeVinci DB copy (it contains every pattern above) | ✅ |
| 9 | New confirmation / publishing rule: wrong-target, stuck-offset (since an untrustworthy baseline) and > 100 mm (`too-large`, operator review) are never published as movement | ✅ |

---

## 3. Health checks (every cycle)

Each check returns `{check, status: ok|warning|bad, message, suggestion, details}`. "bad" holds the cycle only where stated.

| # | Check | Detection | Effect |
|---|---|---|---|
| 3.1 | `instrument-rotation` | median Hz change of the references vs the previous trustworthy cycle, with V and distance unchanged (> 5 mgon) | warning "instrument turned X mgon on its base — results still valid, check the mount"; results unaffected (the resection absorbs a pure rotation) |
| 3.2 | `instrument-stability` | tilt read at the start **and** end of the cycle; jump vs the last cycles' range; **R1 re-measured at the end of the reference set** (one extra target) → drift during the reference measurement | warning on a tilt jump; **hold** if the drift during the reference set exceeds a threshold (it corrupts the solve) |
| 3.3 | `reference-consistency` | per-reference residual history (last N cycles): constant residual (mean > 3 mm, spread < 1 mm) = coordinate problem; variable = noise. Plus the reference-to-reference distance check each cycle | "R2 is 7 mm off every cycle — its coordinates don't match R3/R5"; reference health view |
| 3.4 | `prism-constant` | a reference's residual (or a re-found change) lies along the line of sight (> 90 %) | "check the prism type / prism constant of R4" |
| 3.5 | `geometry` | farthest monitored distance / median reference distance; minimum Hz separation between references | "weak geometry — add a far reference in another direction" |
| 3.6 | `swapped-prisms` | a point's measurement lands on another point's baseline for N cycles running (mutual = swap) | "D8 and G11 are swapped — Re-aim"; never published as movement |
| 3.7 | `stuck-offset` | displacement > tolerance that repeats within a few mm for N cycles, and/or a constant offset since the baseline cycle, especially when that cycle was untrustworthy (few refs / bad RMS) | "A2: 1.19 m every cycle — wrong prism or wrong baseline"; "13 points baselined in cycle 215 (3 refs) — re-baseline"; no alarm |
| 3.8 | `duplicate-points` | two point ids with baselines < 30 mm apart (B1 / f4p4?) | "probably the same prism defined twice" |
| 3.9 | Re-baseline action | operator selects points (or "all points baselined in cycle X"); new baseline = current trusted position; old baseline kept in history; a `frame-change` / baseline event goes to the cloud so the cloud shifts the series (today done by hand as `ats-setup`) | needed to clear the 7–9 / 17–25 / 92–107 mm groups once the frame is stable |
| 3.10 | `link` | count of timeouts / truncated responses / reconnects in the cycle | warning; the desync fix (item 2) prevents the cascade |

The health status of the station = worst of the checks. It is stored with the cycle (`cycles.qc_json`), shown on a **Station health** card, and published (§4).

---

## 4. Cloud contract (message for the bridge team)

**Topic:** `scanin/{gatewayId}/uplink/ats-health`, e.g. `scanin/ATS-5/uplink/ats-health`. Gateway id, same as `uplink/status`, not a per-point id. **Do not create a sensor for it.** QoS 1, one message per monitoring cycle (~every 4 h), ~5–10 KB. Until the bridge handles it, it lands in `ats_raw_payloads` like every non-sample ATS message.

**Payload (`schemaVersion: 1`):**

```json
{
  "schemaVersion": 1,
  "timestamp": 1791718000,
  "deviceId": "ATS-5",
  "siteId": "DeVinci-1",
  "cycle": { "id": 276, "startedAt": 1791717899, "finishedAt": 1791719500,
             "status": "ok|held|failed|cancelled", "quality": "ok|warning|bad",
             "held": false, "published": 55,
             "flags": [{ "flag": "few-references", "level": "bad", "message": "..." }] },
  "resection": { "rmsMm": 5.18, "rmsBeforeExclusionMm": 5.18,
                 "refsUsed": ["R1","R2","R3","R4","R5"],
                 "refsFailed": [{ "id": "R5", "reason": "..." }],
                 "refsExcluded": [{ "id": "R4", "reason": "...", "residualMm": 46.0 }],
                 "residualsMm": { "R1": 6.18, "R2": 7.08 }, "noRedundancy": false },
  "frame": { "prevCycle": 275, "rotMgon": 1.2, "shiftMm": 0.4, "rawRefMoveMm": 0.3,
             "instrumentRotationMgon": -28.5, "verdict": "stable|solve-moved|instrument-moved" },
  "orientation": { "slopeMmPerM": 0.03, "r2": 0.2, "impliedRotMgon": 2, "detected": false, "notFitting": [] },
  "counts": { "ok": 50, "warning": 3, "suspect": 2, "wrongTarget": 2, "held": 0, "failed": 4 },
  "points": [{ "id": "D8", "status": "wrong-target", "dispMm": 7686.8, "matchedPoint": "G11", "reason": "..." }],
  "health": { "status": "ok|warning|bad",
              "checks": [{ "check": "instrument-rotation", "status": "warning",
                           "message": "instrument turned -28.5 mgon on its base since cycle 275",
                           "suggestion": "check the mount", "details": {} }] },
  "instrument": { "tiltStart": { "crossMgon": 5.0, "lengthMgon": 2.1 },
                  "tiltEnd": { "crossMgon": 4.6, "lengthMgon": 2.0 }, "refDriftMgon": 0.3 }
}
```

`check` values: `instrument-rotation`, `instrument-stability`, `reference-consistency`, `prism-constant`, `geometry`, `swapped-prisms`, `stuck-offset`, `duplicate-points`, `link` — treat unknown values as plain text (more will be added).

**Firestore — new collection `ats-station-health`:**
- `ats-station-health/{deviceId}` — latest state, overwritten each message: the payload + `lastSeenAt` (serverTimestamp) + `lastCycleId`.
- `ats-station-health/{deviceId}/cycles/{siteId}_{cycleId}` — history, full payload + `receivedAt` (deterministic id → re-sends are idempotent).
- Unknown `schemaVersion` → keep storing raw in `ats_raw_payloads`, log a warning.

**Samples (`uplink/samples`, existing):** `sensorData` gains optional `qc_flag` (`wrong-target` | `re-measured` | null), `matched_point`, `held` (bool), `cycle_id` — please copy them into the data-log doc next to `suspect` / `suspect_reason` (absent when unset).

**Later (not now):** the watchdog alerts on `ats-station-health/{deviceId}.health.status` + `lastSeenAt`; the web platform gets a station-health page.

---

## 5. Decisions (Hillel)

1. **Publish held / wrong-target samples to the cloud** (marked `suspect=true`, which `checkThresholds` already skips)? Risk: charts show them if the UI doesn't filter `suspect`. Proposal: per-site setting, **off by default**, on once the UI hides/marks suspect samples.
2. Collection name `ats-station-health` — OK?
3. Re-baselining (§3.9): which groups to reset first at DeVinci, and does the cloud side apply the `ats-setup` offset automatically or by hand for now?

---

## 6. Deploy order

1. Bridge change (optional first — messages are kept in `ats_raw_payloads` meanwhile).
2. ATS release on **DeVinci** after approval → watch 2–3 cycles (health card, published message, no false holds).
3. Other stations — check first which have only 3 references (`POST /api/qc-settings {"min_refs_publish": 3}` or add a reference).
4. Re-baseline the stuck-offset groups once the frame is stable (§3.9).

## 7. Acceptance

Replay on the DeVinci DB copy (2026-10-11): 276 → `instrument-rotation` ≈ −28.5 mgon; 270–275 → `instrument-stability`; R1/R2 → `reference-consistency`; R4 re-found → `prism-constant` hint; D8↔G11 → `swapped-prisms`; F11, I11, A2, B1 → `stuck-offset` / wrong target; the cycle-215 group (~100 mm) and 216/234 group (~20 mm) → `stuck-offset` with "baselined in an untrustworthy cycle"; geometry warning (refs 17–19 m vs points 30–70 m).
