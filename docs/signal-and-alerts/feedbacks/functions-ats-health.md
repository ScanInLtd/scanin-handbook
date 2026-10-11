# Feedback: `scanin-svc-firebase-functions` — ATS station health: notices + noise reduction

**Date:** 2026-10-11
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Input:** `docs/ats/bridge-ats-health-handoff.md` (bridge writes `ats-station-health/{gatewayId}` + `/cycles` + `/events`), diagnosis `docs/ats/devinci-diagnosis-2026-10-11.md`
**Status:** ✅ approved + message fixes (§6), committed **`6a87a0a`** + **`4579e86`**, **deployed 2026-10-11 13:55 UTC** (onAtsCycleReport · onAtsStationEvent · atsHealthSweep created; checkThresholds · detectLevelShifts · notifyDataIntegrity · sendWhatsappAlerts updated; 0 errors). Replay **21/21** — final renders in §6. Depends on the bridge deploy (§2–§4 of the handoff) to receive real data; harmless before that (the triggers just never fire).

---

## 1. New notice kinds — one per STATION

`sensorId` = gateway id (e.g. `ATS-5`); `projectId` = the project of the station's sensors (via `ats-device-map/{gateway}-*`, fallback `siteId`), so the existing 5-min per-site grouping merges a cycle's notices into one WhatsApp. Functions-owned memory: `ats-station-state/{gatewayId}` (held streak, point-issue streaks, last health); cycle re-sends older than the last processed `cycle.finishedAt` are skipped.

| Kind | Trigger | Notify | Resolve |
|---|---|---|---|
| `ats-station-health` | cycle report, `health.status` ok → warning/bad; lines = failing checks (Hebrew check name + station message + 💡 suggestion) | on open; **re-notified** on warning→bad or when a **new check** starts failing (otherwise new problems would be silent while the notice stays open) | health ok |
| `ats-cycle-held` | `cycle.held` / status held; reason from `cycle.flags` (Hebrew for known flags) | on open; **critical + re-notified** at 2 consecutive held cycles | next evaluated non-held cycle (failed/cancelled cycles are neutral) |
| `ats-station-silent` | `atsHealthSweep` hourly part: `lastSeenAt` older than `atsSilentHours` (default 9); `lastStatusAt` within `atsHeartbeatFreshMinutes` (default 60) → "חיה, אבל לא מודדת", else "גם אין סימני חיים" | on open | next cycle report |
| `ats-point-issues` | wrong-target / swapped-prisms / stuck-offset / duplicate-points persisting **≥ 2 evaluated cycles** (held/failed cycles don't move the streaks); one notice with the suggested action per issue; swapped pairs replace their two wrong-target lines; stuck-offset points folded into one line | on open; re-notified when a **new** issue joins | list empty |
| `ats-rebaseline` | informational: station rebaseline applied / reference re-found | on create (resolved immediately) | — |

**Handoff §5 — `onAtsStationEvent`:** `rebaseline` + `status: pending-baseline` → `applyBaseline` per point with a `sensorId` (`reason: rebaseline`, time `at·1000`, zero initials on E/N/H/TwoD, note with Δ and source cycles) → event `status: applied | partial` + per-point `results`; idempotent (anything not `pending-baseline` is skipped). `reference-refound` → informational notice once (`notified: true`).

## 2. Noise reduction

| | Rule | Implementation |
|---|---|---|
| a | `qc_flag` wrong-target / stuck-offset / too-large, or `held` | sample marked `suspect: true`, `suspect_reason: ats-qc:<flag>` / `ats-held` (ingestion-style reason → recompute preserves it); no evaluation, no notice (`SKIP-ATS-QC`) |
| b | implausible-jump on an ATS sample (`gateway_id` + `cycle_id`) | deferred: decided immediately if the cycle doc exists, else stored in `ats-pending-jumps` and settled by the cycle trigger; after 10 min without a report the sweep raises it (`station: no-report`). Explained = point status ≠ passed, cycle held, frame/orientation/resection/reference flag, or frame verdict ≠ stable → no notice (`ATS-JUMP-EXPLAINED`). Station says passed → raised as today with `details.station` → the template adds "🛰️ התחנה אומרת שהמדידה תקינה (מחזור N)" |
| c | late-data on ATS-fed sensors | suppressed (`SKIP-ATS-LATE`) — covered by `ats-station-silent` |
| d | level-shift on ATS sensors | dropped when a rebaseline of that point, a reference-refound or a frame change (cycle `frame.verdict ≠ stable`) falls within ±1 cycle (~5 h) of the step day (`SKIP-ATS-LEVELSHIFT`) |

Also: the WhatsApp sender now drains **every** closed group window of a project per run (it used to send only the first window per run).

## 3. Emulator — 18/18 ✅

Fixtures for ATS-5 / DeVinci-1 cycles 251–277 from the diagnosis (§2–§3): 251 held (RMS 23.4, R4 off), 252 held (3 refs, frame rotated 264 mgon), 253 back to 4 refs with the point issues (A2/F11/I11/f8p1 wrong prism, D8↔G11 swapped, B1=f4p4 duplicate, 9 cycle-215 points stuck 92–110 mm), 254 held (R2 failed), 255–269 steady, 270–271 held (refs lost), 272 failed (link desync, 59/61), 273–275 held + instrument unstable, R4 re-found, 276 all 5 refs + instrument turned −28.5 mgon, 277 steady, then the station rebaseline of the 9 stuck points.

- **27 cycles + 2 events → 12 WhatsApp messages**; cycles 256–269 (steady) → nothing.
- 251 → one grouped message (health warning + held); 252 → one message with the escalations (health bad + 2nd held → critical).
- Point issues open at 255 (2nd evaluated cycle — 254 was held and doesn't count); D8 ↔ G11 shown as one swap line.
- New failing checks re-notify: 273 instrument stability, 276 instrument rotation.
- Rebaseline event applied to all 9 sensors (baseline-events with zero initials, event `applied`).
- Noise paths: (a) qc_flag sample → suspect, no notice; (b) two jumps deferred; cycle report explains P2 (point suspect) → no notice; P3 passed → notice tagged "station says ok"; pending docs cleared; (c) 60 h-late ATS sample → no late-data; (d) a step near the f4p4 rebaseline → suppressed, days later → not.
- Silent station (10 h, heartbeat 5 min old) → "התחנה חיה, אבל לא מודדת".

_Renders: see §6 (re-rendered after the message fixes)._

## 4. Deploy plan (pending approval)

1. `firebase deploy --only functions:onAtsCycleReport,functions:onAtsStationEvent,functions:atsHealthSweep,functions:checkThresholds,functions:detectLevelShifts,functions:notifyDataIntegrity,functions:sendWhatsappAlerts` (first three are new).
2. No new composite indexes: the pending-jump queries are equality-only / single-field; events/cycles range queries are single-field.
3. Optional config in `system-config/data-integrity`: `atsSilentHours` (default 9), `atsHeartbeatFreshMinutes` (default 60).
4. Order vs the bridge: either order works. Before the bridge deploy nothing fires; after it, the first cycle report seeds `ats-station-state`.

Rollback: redeploy `8599d35` and delete the three new functions; station notices are standalone.

## 5. Notes for the station / bridge teams

- **Firestore can't store nested arrays.** `health.checks[].details` with `pairs: [["D8","G11"]]` would fail the bridge's write (found when the emulator write crashed on it). Use `pairs: [{a: "D8", b: "G11"}]` for swapped-prisms / duplicate-points (both shapes are parsed here; only the object form can actually be stored).
- `ats-station-silent` relies on the bridge's optional §3.3 (`lastStatusAt` from `uplink/status`); without it every silent station reads as "no heartbeat".
- Jump deferral needs `gateway_id` + `cycle_id` on samples (handoff §2); older samples raise as before.

---

## 6. Review round (commit `4579e86`, deployed with the rest 2026-10-11 13:55 UTC)

1. **Hebrew check templates from `details`** — instrument-rotation (`rotMgon`, `sinceCycle`), instrument-stability (`tiltJumpMgon`), reference-consistency (`refId`, `residualMm`), prism-constant (`pointId`, `offsetMm`), geometry (`refsUsed`, `rotMgon`), link (`reconnects`/`timeouts`, `failedPoints`, `totalPoints`), frame-offset (`offsetMm`). Missing numbers degrade to a Hebrew sentence without them; the station's English `message` / `suggestion` appear only for **unknown** checks. **Station team: please send these `details` keys** (they're the contract the templates read).
2. **Point-level checks** (swapped-prisms, duplicate-points, stuck-offset) are excluded from `ats-station-health`; the health status used for transitions is the worst of the remaining station-level checks. Effect in the replay: 253 no longer opens a health message (only point issues remain → covered at 255 by `ats-point-issues`), and 276 lists only rotation + frame offset.
3. **Partial rebaseline**: `onAtsStationEvent` records the points without a sensor and the message adds `⚠️ נקודות ללא חיישן: …` (replay: f6p13).

Replay checks added: no English station text in any ATS-5 message; no point-level check in a station-health message; the partial line. **21/21 green; 27 cycles + 2 events → 11 WhatsApp messages.**

### Final renders (emulator, in order)

```
----- cycle 251 -----
*מגדל דה וינצי דרום — 2 הודעות חדשות*

⚠️ תחנה ATS-5 · עקביות רפרנסים
⏸️ מחזור 251 נעצר · חיתוך לא טוב (RMS גבוה)

🔗 https://new-scanin-ui.web.app/integrity?project=dv-proj

----- cycle 252 -----
*מגדל דה וינצי דרום — 2 הודעות חדשות*

🔴 תחנה ATS-5 · גאומטריה
⏸️ מחזור 252 נעצר (2 ברצף) · מעט מדי רפרנסים

🔗 https://new-scanin-ui.web.app/integrity?project=dv-proj

----- cycle 254 -----
⏸️ *מחזור מדידה נעצר*
הנתונים לא פורסמו ללקוח

📍 תחנה ATS-5 · מגדל דה וינצי דרום

🔁 מחזור 254
🚩 מעט מדי רפרנסים
📐 3 רפרנסים · RMS 1.7 מ"מ

*מה לעשות?*
🔧 לבדוק רפרנסים וקו ראייה

🔗 https://new-scanin-ui.web.app/integrity/vz1TbHLRjWwLDW6Rzoma

----- cycle 255 -----
🎯 *נקודות בעייתיות בתחנה*
16 נקודות, 2+ מחזורים ברצף

📍 תחנה ATS-5 · מגדל דה וינצי דרום

🎯 A2 מודדת פריזמה אחרת ← לכוון מחדש
🎯 F11 מודדת פריזמה אחרת ← לכוון מחדש
🎯 I11 מודדת פריזמה אחרת (H11) ← לכוון מחדש
🎯 f8p1 מודדת פריזמה אחרת ← לכוון מחדש
🔀 D8 ↔ G11 פריזמות מוחלפות ← להחליף שיוך
👯 B1 = f4p4 אותה פריזמה פעמיים ← למחוק אחת
📌 9 נקודות בסטייה קבועה (92.1–110 מ"מ): f4p4, f4p7, f5p7, f5p8, f5p10, f5p13, f6p7, f6p10, f8p13 ← baseline חדש

🔗 https://new-scanin-ui.web.app/integrity/mLNAKimfvifcP1mcrSdU

----- cycle 270 -----
⏸️ *מחזור מדידה נעצר*
הנתונים לא פורסמו ללקוח

📍 תחנה ATS-5 · מגדל דה וינצי דרום

🔁 מחזור 270
🚩 מעט מדי רפרנסים
📐 2 רפרנסים · RMS 2.1 מ"מ

*מה לעשות?*
🔧 לבדוק רפרנסים וקו ראייה

🔗 https://new-scanin-ui.web.app/integrity/BS2wdmqsHQAEoqRzgfGh

----- cycle 271 -----
‼️ *מחזורי מדידה נעצרים ברצף*
הנתונים לא פורסמו ללקוח

📍 תחנה ATS-5 · מגדל דה וינצי דרום

🔁 מחזור 271 · 2 מחזורים ברצף
🚩 מעט מדי רפרנסים
📐 2 רפרנסים · RMS 2.4 מ"מ

*מה לעשות?*
🔧 לבדוק רפרנסים וקו ראייה

🔗 https://new-scanin-ui.web.app/integrity/BS2wdmqsHQAEoqRzgfGh

----- cycle 272 -----
🔴 *תחנת ATS במצב לא תקין*
מחזור 272

📍 תחנה ATS-5 · מגדל דה וינצי דרום

🔴 תקשורת עם המכשיר: ניתוק אחד · 59 מתוך 61 נקודות נכשלו
💡 לאתחל את החיבור למכשיר ולבדוק את הכבל

🔗 https://new-scanin-ui.web.app/integrity/Dwf9uf5s9KnJRYCJUnVz

----- cycle 273 -----
🔴 *תחנת ATS במצב לא תקין*
מחזור 273

📍 תחנה ATS-5 · מגדל דה וינצי דרום

🔴 יציבות המכשיר: הטיית המכשיר קפצה 6 mgon במהלך המחזור
💡 לבדוק יציבות המתקן והברגים

🔗 https://new-scanin-ui.web.app/integrity/Dwf9uf5s9KnJRYCJUnVz

----- cycle 275 -----
♻️ *רפרנס אותר מחדש*
לידיעה בלבד

📍 תחנה ATS-5 · מגדל דה וינצי דרום

📌 R4 · Δ 58.5 מ"מ
📐 RMS 4.38 מ"מ

🔗 https://new-scanin-ui.web.app/integrity/YromSPkVtMXDCxRUtb48

----- cycle 276 -----
⚠️ *אזהרת תקינות בתחנת ATS*
מחזור 276

📍 תחנה ATS-5 · מגדל דה וינצי דרום

⚠️ סיבוב המכשיר על הבסיס: ‎-28.5 mgon מאז מחזור 269
💡 לבדוק את התושבת ואת ברגי המתקן (התוצאות לא מושפעות)
⚠️ הסטת מערכת הייחוס: 8.2 מ"מ מה-baseline של הנקודות
💡 לקבוע baseline מחדש כשמערכת הייחוס יציבה

🔗 https://new-scanin-ui.web.app/integrity/Dwf9uf5s9KnJRYCJUnVz

----- rebaseline event -----
♻️ *התחנה קבעה baseline מחדש*
לידיעה בלבד

📍 תחנה ATS-5 · מגדל דה וינצי דרום

📌 9 נקודות: f4p4, f4p7, f5p7, f5p8, f5p10, f5p13, f6p7, f6p10, f8p13
📏 Δ עד 110 מ"מ
⚠️ נקודות ללא חיישן: f6p13

🔗 https://new-scanin-ui.web.app/integrity/H9Mjers1Ken6oFGESwdl

----- ATS-9 jump (station says passed) -----
🔴 *קריאה חשודה*
לא נשלחה ללקוח

📍 ATS.Test-9.P3 · ATS-9 בדיקות
🧭 s

📏 HeightDisplacement: *500 *
🛰️ התחנה אומרת שהמדידה תקינה (מחזור 901)

*מה לעשות?*
🔧 הוזז / הוחלף ← baseline חדש
✅ תזוזה אמיתית ← אשר והתרע
🗑️ תקלה ← התעלם

🔗 https://new-scanin-ui.web.app/integrity/VfnfbhijOHh5atDsw0Wr

----- silent check -----
📴 *תחנת ATS לא מודדת*

📍 תחנה ATS-5 · מגדל דה וינצי דרום

⏳ מחזור אחרון לפני 10 שעות
💓 התחנה חיה, אבל לא מודדת

*מה לעשות?*
🖥️ לבדוק את תוכנת המדידה ואת המכשיר

🔗 https://new-scanin-ui.web.app/integrity/VHoLLRf8tln7PyzVAhO6
```

(The ATS-9 jump render shows the raw axis key because the emulator had no prism registry doc for that test; prod has it → "שקיעה · מ"מ".)
