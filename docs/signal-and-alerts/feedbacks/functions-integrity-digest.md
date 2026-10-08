# Feedback: `scanin-svc-firebase-functions` — integrity digest: fewer, grouped messages

**Date:** 2026-10-08
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Trigger:** DeVinci sent 33 WhatsApp messages in 3 days (one notice per sensor+axis, one message per notice) → ignored.
**Status:** implemented & committed (**`c5e067f`**), emulator digest suite **14/14** + integrity-actions regression green, prod migration dry-run done (33 open → 15). **NOT deployed — pending approval.**

---

## 1. One notice per sensor per kind

- `integrityDedupeKey` = `kind:sensorId:` (the axis argument is still accepted but ignored — call sites unchanged).
- Affected axes live in **`details.axes [{axis, value, ref, limit?, size?, day?, sampleTime}]`**; `raiseIntegrity` merges the list by axis on every bump (incoming entry wins), so a later sample hitting another axis adds to the same notice.
- `checkThresholds` raises ONE notice per kind with all violating axes of the sample; a clean sample auto-resolves the sensor's notice. `detectLevelShifts` raises ONE notice per sensor with every shifted axis (top-level size/day = the largest step).
- `releaseSuspect` now releases **every axis** of the notice: per-axis new ref, one recompute with `initialRef`/`noSuspectAxes` for all axes, tier replay per axis (≤ 1 alert per axis). Result keeps `newRef`/`finalStatus` (main axis) and adds `newRefs`/`finalStatuses`/`alertsCreated`.
- Templates read `details.axes` (legacy `axis`/`otherAxes` still rendered).

**Migration on deploy** — `scripts/migrate-integrity-per-sensor.js` (dry-run default): per (kind, sensor) the oldest open notice survives, gets the new key + merged `details.axes` + summed count; the rest → `resolved / merged / mergedInto`. Updates only → nothing is re-sent. **Prod dry-run (2026-10-08): 33 open notices → 15** (15 groups re-keyed, 18 merged; mostly DeVinci prisms with 2–3 axes each).

## 2. Per-site grouping in the sender

- `notifyDataIntegrity` stamps `whatsapp.queuedAt`; the sender groups pending notices **per project**: everything queued within **`system-config/data-integrity.groupWindowMinutes`** (default **5**) of the first goes out as ONE message once that window has closed (max delay ≈ window + 1 scheduler minute). Every kind goes out right after its window — no daily digest.
- 2+ notices: `*‹site› — ‹n› הודעות חדשות*` + one short line per notice (emoji · sensor · kind · main numbers, "+N צירים") + `https://new-scanin-ui.web.app/integrity?project=‹id›` (UI adds the filter). A lone notice keeps the full template.
- Each notice's `whatsapp.sent` gets `{to, at, grouped}`; failures follow the existing 3-pass rule with notice ids in the error log.

## 3. Pattern lines (replace their member lines)

- **Target swap 🔄** — two `implausible-jump` notices, same station (`atsSiteId`, fallback project), sample times ≤ 10 min apart, Δ mirrored within 5% on every common non-derived axis (TwoD / registry `derived` axes excluded — magnitudes can't mirror) → `התחנה החליפה בין f11p9 ↔ f11p11`.
- **Re-setup 🏗️** — ≥ 3 `level-shift` notices in the project on the same day with a step within 10% of the median → one line listing them + `לקבוע baseline לכולן`.

## 4. Emulator — 14/14 ✅

| Case | Result |
|---|---|
| Live dedupe | a sample jumping on x+y → exactly 1 notice, `details.axes` = [x, y], key `implausible-jump:‹sensor›:` |
| Floor 11 | 4 sensors × 3 axes, f11p9/f11p11 mirrored → **1 message**, swap line, header "4 הודעות חדשות", project link; all 4 notices `sent` |
| 9 level-shifts | same day, steps 4.85–5.15 → **1 message** with the re-setup line listing all 9 |
| Lone notice | full single template (מה לעשות + `/integrity/‹id›`) |

Integrity-actions suite (release/ignore/baseline/closed-site/duplicates) re-run green after the multi-axis refactor.

### Renders (emulator, verbatim)

**Floor 11:**
```
*מגדל דה וינצי דרום — 4 הודעות חדשות*

🔄 התחנה החליפה בין f11p9 ↔ f11p11
🔴 f11p10 · קריאה חשודה · תזוזה מזרח 150 מ"מ (+2 צירים)
🔴 f11p12 · קריאה חשודה · תזוזה מזרח ‎-120 מ"מ (+2 צירים)

🔗 https://new-scanin-ui.web.app/integrity?project=dg-devinci
```

**9 level-shifts:**
```
*SAVYON LIVING — 9 הודעות חדשות*

🏗️ הקמה מחדש של נקודות? 9 נקודות זזו ~5 מ"מ ב-07.10: p1, p2, p3, p4, p5, p6, p7, p8, p9 — לקבוע baseline לכולן

🔗 https://new-scanin-ui.web.app/integrity?project=dg-resetup
```

**Lone notice:**
```
📐 *קפיצת מדרגה*
ייתכן שהחיישן הוזז או הוחלף

📍 פריזמה 7 · צייטלין 12
🧭 s

📏 שקיעה: *3.2 מ"מ* מאז 07.10

*מה לעשות?*
🔧 הוזז / הוחלף ← baseline חדש
✅ תזוזה אמיתית ← אשר
🗑️ תקלה ← התעלם

🔗 https://new-scanin-ui.web.app/integrity/sSsQXs39KlVBOXprfLPA
```

## 5. Deploy plan (pending approval)

1. `firebase deploy --only functions:checkThresholds,functions:detectLevelShifts,functions:notifyDataIntegrity,functions:sendWhatsappAlerts,functions:releaseSuspect`
2. Immediately after: `node scripts/migrate-integrity-per-sensor.js --apply` (33 → 15; until it runs, a new hit on a sensor with legacy per-axis notices opens a fresh per-sensor notice instead of bumping).
3. Optional: set `groupWindowMinutes` in `system-config/data-integrity` (default 5 when absent).
4. UI: `/integrity?project=` filter (web-platform).

Rollback: redeploy `94153b4` (migrated notices stay merged — harmless; old code would just open per-axis notices again).
