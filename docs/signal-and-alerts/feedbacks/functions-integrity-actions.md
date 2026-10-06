# Feedback: `scanin-svc-firebase-functions` — integrity notices: readable WhatsApp text + actions

**Date:** 2026-10-06
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Spec:** `integrity-actions.md` §2 (approved layout §1)
**Status:** ✅ approved with one change (uiPageLive dropped — §6), committed **`da58113`** + **`cdf4517`**, emulator **17/17** green, final renders in §6. **NOT deployed — waiting for Hillel's go once the web-platform `/integrity` page is live** (otherwise WhatsApp links point at a missing page).

---

## 1. What changed

| Piece | Implementation |
|---|---|
| `src/integrity/integrityMessages.ts` (new) | One Hebrew template per kind, exactly the §1 layout: short lines, blank line between sections, one emoji per line, no dividers/ids/English codes. Names via `resolveLocationNames`; axis label + unit from the registry (mm → מ"מ); `he-IL` thousands separators. Kinds: implausible-jump / out-of-range (incl. the ↔️ "other axes that also jumped" line — the violations are now stored in `details.otherAxes` at raise time), late-data, level-shift, unconfirmed-sensor, test; unknown kind → `notice.message` fallback (delivery is never blocked). |
| UI-page gate | `system-config/data-integrity.uiPageLive` (default false): link = `/s/<sensorId>` and the page-dependent "מה לעשות?" blocks are omitted; once the UI page ships, flip the flag (no redeploy) → link = `/integrity/<noticeId>` + full action blocks. late-data ("לבדוק לוגר ותקשורת") and unconfirmed-sensor ("לאשר את הנקודה בעמוד החיישן") keep their blocks in both modes — they don't need the page. |
| `notifyDataIntegrity` | Uses the builder; config/severity gates and outbox delivery unchanged. |
| `releaseSuspect({noticeId})` (new callable, admin) | Clears EVALUATOR-set suspect flags (`implausible-jump`/`out-of-range` only — ingestion flags like `run-common-mode` never touched) since `suspectSince` (48h sample-time floor); the released level (median of the released samples' adjusted values) becomes the new `ref`; `recomputeSmoothing` from the earliest released sample with two new core params — `initialRef` (chain starts at the released level) and `noSuspectAxes` (the admin declared the samples real; without these the moving ref re-flags the episode — caught by the emulator); then the released samples get their **normal v2 tier evaluation replayed in order** over the recomputed smooth — at most ONE alert (the last escalation), created only if the tiers say so (≥3h AND ≥2 evals beyond the level; `releasedFromNotice` links it back). Resolves the notice `released` with who/when. |
| `ignoreNotice({noticeId, note?})` (new callable, admin) | Resolves `ignored` (+ optional `resolutionNote`); samples stay suspect. |
| `setBaseline` | Accepts optional `noticeId` → stamped `resolvedViaNoticeAction: 'setBaseline'` and resolved `baseline` (applyBaseline already resolves the sensor's open notices; this records the specific notice/by). |

## 2. Emulator — 14/14 ✅

- **Release:** 10-sample suspect episode (tilt, jump 9° vs ref 0.05) → `releaseSuspect`: 10 flags cleared, ref 0.05 → 9, smooth recomputed over the episode, **exactly one `confirmed` warn alert** (the replayed tiers crossed warn for ≥3h / ≥2 evaluations), status → warn, notice `released`, `suspectSince` cleared, the `run-common-mode` ingestion doc untouched.
- **Ignore:** notice `ignored` + note; the suspect sample stays suspect.
- **Baseline:** fresh episode → `applyBaseline` → notice `baseline`.
- All templates rendered in both `uiPageLive` modes (below).

## 3. Rendered templates (emulator output, verbatim)

```
----- implausible-jump (uiPageLive=false) -----
🔴 *קריאה חשודה*
לא נשלחה ללקוח

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

📏 הטיה X: *8.95 °*
↔️ הטיה Y 4.2 °

🔗 https://new-scanin-ui.web.app/s/ia-rel

----- implausible-jump (uiPageLive=true) -----
🔴 *קריאה חשודה*
לא נשלחה ללקוח

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

📏 הטיה X: *8.95 °*
↔️ הטיה Y 4.2 °

*מה לעשות?*
🔧 הוזז / הוחלף ← baseline חדש
✅ תזוזה אמיתית ← אשר והתרע
🗑️ תקלה ← התעלם

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123

----- late-data (uiPageLive=false) -----
🕒 *חיישן מעלה נתונים באיחור*

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

⏳ באיחור של *3.2 ימים*
📅 קריאה אחרונה שנמדדה: 03.10

*מה לעשות?*
📡 לבדוק לוגר ותקשורת

🔗 https://new-scanin-ui.web.app/s/ia-rel

----- late-data (uiPageLive=true) -----
🕒 *חיישן מעלה נתונים באיחור*

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

⏳ באיחור של *3.2 ימים*
📅 קריאה אחרונה שנמדדה: 03.10

*מה לעשות?*
📡 לבדוק לוגר ותקשורת

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123

----- level-shift (uiPageLive=false) -----
📐 *קפיצת מדרגה*
ייתכן שהחיישן הוזז או הוחלף

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

📏 הטיה X: *1.3 °* מאז 03.10

🔗 https://new-scanin-ui.web.app/s/ia-rel

----- level-shift (uiPageLive=true) -----
📐 *קפיצת מדרגה*
ייתכן שהחיישן הוזז או הוחלף

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

📏 הטיה X: *1.3 °* מאז 03.10

*מה לעשות?*
🔧 הוזז / הוחלף ← baseline חדש
✅ תזוזה אמיתית ← אשר
🗑️ תקלה ← התעלם

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123

----- unconfirmed-sensor (uiPageLive=false) -----
🆕 *חיישן בהקמה ממתין לאישור*

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

🗓️ יימחק ב-08.10

*מה לעשות?*
✅ לאשר את הנקודה בעמוד החיישן

🔗 https://new-scanin-ui.web.app/s/ia-rel

----- unconfirmed-sensor (uiPageLive=true) -----
🆕 *חיישן בהקמה ממתין לאישור*

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

🗓️ יימחק ב-08.10

*מה לעשות?*
✅ לאשר את הנקודה בעמוד החיישן

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123

----- test (uiPageLive=false) -----
🧪 *בדיקה*

בדיקת מערכת

🔗 https://new-scanin-ui.web.app/s/ia-rel

----- test (uiPageLive=true) -----
🧪 *בדיקה*

בדיקת מערכת

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123

----- unknown-kind (uiPageLive=false) -----
fallback message

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

🔗 https://new-scanin-ui.web.app/s/ia-rel

----- unknown-kind (uiPageLive=true) -----
fallback message

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123
```

## 4. Deploy plan (pending approval) & rollback

1. `firebase deploy --only functions:notifyDataIntegrity,functions:checkThresholds,functions:setBaseline,functions:recomputeSmoothing,functions:releaseSuspect,functions:ignoreNotice` (last two are new callables). No new indexes.
2. `uiPageLive` stays false until the web-platform `/integrity` page ships (UI-1.3), then Hillel flips it — texts upgrade instantly.
3. **Rollback:** redeploy `a3a0e34`; the new callables can be deleted; `details.otherAxes` on notices is additive.

## 5. Open questions

1. The release replay evaluates the episode's samples with the tier clocks — if the episode was **shorter than 3h**, no alert fires at release and the escalation completes on the next live samples. Matches "a client alert goes out only if the tiers say so"; flagging the latency so no one expects an instant alert on short episodes.
2. `releaseSuspect` clears flags for the whole sensor since the episode start (all axes with evaluator reasons, matching the one-violation-flags-the-whole-sample write); the ref/replay applies to the notice's axis. Multi-axis episodes release together — intended?

---

## 6. Review change: uiPageLive dropped (`cdf4517`)

The `/integrity` page ships together with this deploy, so there is no transition period: `system-config/data-integrity.uiPageLive` and both code paths were removed. Every message always links to `https://new-scanin-ui.web.app/integrity/‹noticeId›` and carries the full per-kind "מה לעשות?" block. Suite re-run: **17/17**. Answers recorded: short-episode releases alert on subsequent live samples (fine); multi-axis episodes release together (intended).

**Deploy gate:** waiting for Hillel's "UI page is live", then:
`firebase deploy --only functions:notifyDataIntegrity,functions:checkThresholds,functions:setBaseline,functions:recomputeSmoothing,functions:releaseSuspect,functions:ignoreNotice`

### Final rendered templates (emulator, verbatim)

```
----- implausible-jump -----
🔴 *קריאה חשודה*
לא נשלחה ללקוח

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

📏 הטיה X: *8.95 °*
↔️ הטיה Y 4.2 °

*מה לעשות?*
🔧 הוזז / הוחלף ← baseline חדש
✅ תזוזה אמיתית ← אשר והתרע
🗑️ תקלה ← התעלם

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123

----- late-data -----
🕒 *חיישן מעלה נתונים באיחור*

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

⏳ באיחור של *3.2 ימים*
📅 קריאה אחרונה שנמדדה: 03.10

*מה לעשות?*
📡 לבדוק לוגר ותקשורת

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123

----- level-shift -----
📐 *קפיצת מדרגה*
ייתכן שהחיישן הוזז או הוחלף

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

📏 הטיה X: *1.3 °* מאז 03.10

*מה לעשות?*
🔧 הוזז / הוחלף ← baseline חדש
✅ תזוזה אמיתית ← אשר
🗑️ תקלה ← התעלם

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123

----- unconfirmed-sensor -----
🆕 *חיישן בהקמה ממתין לאישור*

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

🗓️ יימחק ב-08.10

*מה לעשות?*
✅ לאשר את הנקודה בעמוד החיישן

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123

----- test -----
🧪 *בדיקה*

בדיקת מערכת

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123

----- unknown-kind -----
fallback message

📍 פריזמה el · SAVYON LIVING
🧭 חזית מערב

🔗 https://new-scanin-ui.web.app/integrity/NOTICE123
```
