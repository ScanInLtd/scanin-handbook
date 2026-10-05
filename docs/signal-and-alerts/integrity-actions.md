# Internal notices: readable WhatsApp messages + actions (approve / baseline / ignore)

_Status: ready to send (Hillel, 2026-10-05 night; to be handed over 2026-10-06)._
_Context: `data-integrity` notices go to the WhatsApp group "TerraScan Monitoring Data Alerts" (`120363412404296225@g.us`, config `system-config/data-integrity`, enabled 2026-10-05). Delivery works (outbox + single sender). The format was tuned in the group with real examples; the approved layout is §1._

## 1. Approved message layout

Short lines, a blank line between sections, one emoji per line, no dividers, no ids or English codes:

```
🔴 *קריאה חשודה*
לא נשלחה ללקוח

📍 פריזמה 12 · SAVYON LIVING
🧭 חזית מערב
📏 שקיעה: *265 מ"מ*
↔️ מזרח 1,068 · צפון 600 מ"מ

*מה לעשות?*
🔧 הוזז / הוחלף ← baseline חדש
✅ תזוזה אמיתית ← אשר והתרע
🗑️ תקלה ← התעלם

🔗 https://new-scanin-ui.web.app/integrity/<noticeId>
```

---

## 2. Message → `scanin-svc-firebase-functions`

```
Internal notices: readable WhatsApp text + actions. Spec:
../scanin-handbook/docs/signal-and-alerts/integrity-actions.md (§1 is the approved layout,
tested in the group with real examples).

A) notifyDataIntegrity text — one Hebrew template per kind, layout exactly as §1:
   short lines, blank line between sections, one emoji per line, no dividers, no doc ids,
   no English codes. Names, not ids (reuse resolveLocationNames; axis label + unit from
   the registry; numbers with thousands separators).
   - implausible-jump / out-of-range:
       🔴 *קריאה חשודה* / לא נשלחה ללקוח
       📍 ‹sensor› · ‹project›   🧭 ‹section›
       📏 ‹axis label›: *‹Δ› ‹unit›*  (Δ = value − ref from details)
       ↔️ other axes of the same sample that also jumped (if any)
       *מה לעשות?*  🔧 הוזז / הוחלף ← baseline חדש · ✅ תזוזה אמיתית ← אשר והתרע ·
                    🗑️ תקלה ← התעלם
   - late-data:   🕒 *חיישן מעלה נתונים באיחור* · 📍/🧭 · ⏳ באיחור של *‹N› ימים* ·
                  📅 קריאה אחרונה שנמדדה: ‹dd.mm› · *מה לעשות?* 📡 לבדוק לוגר ותקשורת
   - level-shift: 📐 *קפיצת מדרגה* / ייתכן שהחיישן הוזז או הוחלף · 📍/🧭 ·
                  📏 ‹axis›: *‹step› ‹unit›* מאז ‹date› · *מה לעשות?* 🔧 ← baseline חדש ·
                  ✅ תזוזה אמיתית ← אשר · 🗑️ ← התעלם
   - unconfirmed-sensor: 🆕 *חיישן בהקמה ממתין לאישור* · 📍 · 🗓️ יימחק ב-‹dd.mm› ·
                  *מה לעשות?* ✅ לאשר את הנקודה בעמוד החיישן
   - test: 🧪 *בדיקה* + message.
   Unknown kind → fall back to notice.message.
   Last line: 🔗 https://new-scanin-ui.web.app/integrity/‹noticeId› (the UI notice page,
   being built now). Until the UI page is live, keep the link to /s/‹sensorId› and omit the
   "מה לעשות?" block for actions that need the page.
   Paste every rendered template (emulator) into the feedback.

B) Actions behind the page (admin callables; every action resolves the notice with who/when):
   - releaseSuspect({ noticeId }) — "תזוזה אמיתית ← אשר והתרע":
     clear evaluator-set suspect flags (implausible-jump / out-of-range) on that sensor/axis
     since suspectSince; set alert_state ref to the current level; recomputeSmoothing from
     suspectSince; clear suspectSince; then re-run the normal v2 evaluation on the latest
     sample (no shortcut — a client alert goes out only if the tiers say so).
     Resolve the notice 'released'. Never touch ingestion suspect flags (run-common-mode etc.).
   - setBaseline: accept an optional noticeId → resolve it with 'baseline' (already resolves
     the sensor's open notices — just record the noticeId/by).
   - ignoreNotice({ noticeId, note? }) → resolve 'ignored' (samples stay suspect).
   Emulator: suspect episode → release → flags cleared, ref moved, smooth recomputed, one v2
   alert if beyond the threshold for the persistence window; ignore → nothing changes but the
   notice; baseline → notice resolved.

Deploy after my approval. Reply → ../scanin-handbook/docs/signal-and-alerts/feedbacks/
functions-integrity-actions.md
```

---

## 3. Message → `scanin-web-platform`

```
Internal notices page (UI-1.3) — the WhatsApp messages to the internal group will link here.
Spec: ../scanin-handbook/docs/signal-and-alerts/integrity-actions.md.

- Route /integrity (list) and /integrity/:noticeId (detail). Admins only.
- List: open notices first (kind icon, sensor · project · section, count, opened / last seen),
  filter by kind / project, resolved ones in a second tab.
- Detail:
  - header: kind title (same Hebrew titles/emoji as the WhatsApp message), sensor · project ·
    section, opened / last seen / count, the notice message;
  - a chart of the sensor's axis around the event (± 3 days): smooth line, raw, suspect
    points as red ✕, baseline markers — reuse the sensor chart components;
  - for suspect kinds: the suspect value vs the reference (Δ + unit);
  - three actions (confirm dialog each, optional note):
      🔧 baseline חדש → setBaseline({ sensorId, reason, time?, noticeId })
      ✅ תזוזה אמיתית — אשר והתרע → releaseSuspect({ noticeId }); the dialog says a client
         alert may be sent
      🗑️ התעלם → ignoreNotice({ noticeId, note })
    Show only the actions that fit the kind (late-data: none — just a link to the sensor;
    unconfirmed-sensor: "אשר נקודה" = the confirm-point flow).
  - after an action: show who resolved it, when, and how.
- Link "פתח חיישן" to /s/:sensorId.
- Mobile first: this page is opened from WhatsApp on a phone.
Deploy to the preview channel first; append to feedbacks/web-platform-ui.md with screenshots
(phone width).
```
