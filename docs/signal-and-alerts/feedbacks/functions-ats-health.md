# Feedback: `scanin-svc-firebase-functions` — ATS station health: notices + noise reduction

**Date:** 2026-10-11
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Input:** `docs/ats/bridge-ats-health-handoff.md` (bridge writes `ats-station-health/{gatewayId}` + `/cycles` + `/events`), diagnosis `docs/ats/devinci-diagnosis-2026-10-11.md`
**Status:** implemented & committed (**`6a87a0a`**), emulator **18/18** (DeVinci cycles 251–277 replay + noise paths), digest + integrity-actions suites green. **NOT deployed — pending approval.** Depends on the bridge deploy (§2–§4 of the handoff) to receive real data; harmless before that (the triggers just never fire).

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

### Rendered messages (emulator, in order)

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

----- cycle 253 -----
⚠️ *אזהרת תקינות בתחנת ATS*
מחזור 253

📍 תחנה ATS-5 · מגדל דה וינצי דרום

⚠️ פריזמות מוחלפות: D8 and G11 read each other's prism
💡 swap the point assignments D8 ↔ G11 (f11p11 ↔ f11p9)
⚠️ נקודות כפולות: B1 and f4p4 have baselines 0 mm apart
💡 one prism is defined twice — delete or fix one point
⚠️ סטייה קבועה: 9 points sit 92–110 mm off their baseline, constant since cycle 215
💡 re-baseline the cycle-215 points once the frame is stable

🔗 https://new-scanin-ui.web.app/integrity/36FQIXyxO7QaDLjUBFUq

----- cycle 254 -----
⏸️ *מחזור מדידה נעצר*
הנתונים לא פורסמו ללקוח

📍 תחנה ATS-5 · מגדל דה וינצי דרום

🔁 מחזור 254
🚩 מעט מדי רפרנסים
📐 3 רפרנסים · RMS 1.7 מ"מ

*מה לעשות?*
🔧 לבדוק רפרנסים וקו ראייה

🔗 https://new-scanin-ui.web.app/integrity/sClhquEOPKivq887VJQq

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

🔗 https://new-scanin-ui.web.app/integrity/Z7B8vTmPMouJgFFYOrlA

----- cycle 270 -----
⏸️ *מחזור מדידה נעצר*
הנתונים לא פורסמו ללקוח

📍 תחנה ATS-5 · מגדל דה וינצי דרום

🔁 מחזור 270
🚩 מעט מדי רפרנסים
📐 2 רפרנסים · RMS 2.1 מ"מ

*מה לעשות?*
🔧 לבדוק רפרנסים וקו ראייה

🔗 https://new-scanin-ui.web.app/integrity/ZLdGjP3TFWwn0fbyKqdI

----- cycle 271 -----
‼️ *מחזורי מדידה נעצרים ברצף*
הנתונים לא פורסמו ללקוח

📍 תחנה ATS-5 · מגדל דה וינצי דרום

🔁 מחזור 271 · 2 מחזורים ברצף
🚩 מעט מדי רפרנסים
📐 2 רפרנסים · RMS 2.4 מ"מ

*מה לעשות?*
🔧 לבדוק רפרנסים וקו ראייה

🔗 https://new-scanin-ui.web.app/integrity/ZLdGjP3TFWwn0fbyKqdI

----- cycle 272 -----
🔴 *תחנת ATS במצב לא תקין*
מחזור 272

📍 תחנה ATS-5 · מגדל דה וינצי דרום

🔴 תקשורת עם המכשיר: 1 timeout → reconnect → 59 of 61 points failed (truncated response)
💡 station release with the desync fix; restart the instrument link

🔗 https://new-scanin-ui.web.app/integrity/36FQIXyxO7QaDLjUBFUq

----- cycle 273 -----
🔴 *תחנת ATS במצב לא תקין*
מחזור 273

📍 תחנה ATS-5 · מגדל דה וינצי דרום

🔴 יציבות המכשיר: tilt jumped 6 mgon between start and end
💡 check the mount / bracket screws

🔗 https://new-scanin-ui.web.app/integrity/36FQIXyxO7QaDLjUBFUq

----- cycle 275 -----
♻️ *רפרנס אותר מחדש*
לידיעה בלבד

📍 תחנה ATS-5 · מגדל דה וינצי דרום

📌 R4 · Δ 58.5 מ"מ
📐 RMS 4.38 מ"מ

🔗 https://new-scanin-ui.web.app/integrity/F2qUz1aMWeNSHMyHdbZp

----- cycle 276 -----
⚠️ *אזהרת תקינות בתחנת ATS*
מחזור 276

📍 תחנה ATS-5 · מגדל דה וינצי דרום

⚠️ סיבוב המכשיר על הבסיס: instrument turned -28.5 mgon on its base since cycle 269
💡 check the mount / bracket screws; results are not affected (the resection absorbs it)
⚠️ פריזמות מוחלפות: D8 and G11 read each other's prism
💡 swap the point assignments D8 ↔ G11 (f11p11 ↔ f11p9)
⚠️ נקודות כפולות: B1 and f4p4 have baselines 0 mm apart
💡 one prism is defined twice — delete or fix one point
⚠️ סטייה קבועה: 9 points sit 92–110 mm off their baseline, constant since cycle 215
💡 re-baseline the cycle-215 points once the frame is stable

🔗 https://new-scanin-ui.web.app/integrity/36FQIXyxO7QaDLjUBFUq

----- rebaseline event -----
♻️ *התחנה קבעה baseline מחדש*
לידיעה בלבד

📍 תחנה ATS-5 · מגדל דה וינצי דרום

📌 9 נקודות: f4p4, f4p7, f5p7, f5p8, f5p10, f5p13, f6p7, f6p10, f8p13
📏 Δ עד 110 מ"מ

🔗 https://new-scanin-ui.web.app/integrity/deXGF2ojft8QSCTnRTOy

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

🔗 https://new-scanin-ui.web.app/integrity/eeV2NziRSkTEe9jNTTbZ

----- silent check -----
📴 *תחנת ATS לא מודדת*

📍 תחנה ATS-5 · מגדל דה וינצי דרום

⏳ מחזור אחרון לפני 10 שעות
💓 התחנה חיה, אבל לא מודדת

*מה לעשות?*
🖥️ לבדוק את תוכנת המדידה ואת המכשיר

🔗 https://new-scanin-ui.web.app/integrity/sERkzjrDRmgfIoBaV6Yz
```

(The ATS-9 jump render shows the raw axis key because the emulator had no prism registry doc for that test; prod has it → "שקיעה · מ"מ".)

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
