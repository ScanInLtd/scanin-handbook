# Feedback: `scanin-web-platform` — A3 Section 2: delete a baseline from the sensor page

**Date:** 2026-10-20
**Repo:** scanin-web-platform
**Task:** [`docs/work-plan/tasks/A3-delete-baseline.md`](../../work-plan/tasks/A3-delete-baseline.md) §"Section 2"
**Status:** 🟢 **deployed LIVE** — https://new-scanin-ui.web.app (2026-10-20 ~14:37Z, `scanin.link@gmail.com` ADC-token deploy, bundle `main-es2015.592fa51b29cd4e9ca047.js`). Shipped together with the map-pin hover fix (same uncommitted working tree on `main`, user approved shipping both). Earlier preview: https://new-scanin-ui--a3-delete-baseline-2pd5r276.web.app. **E2E test on a `בדיקות משרד` sensor still pending — do it before any real-sensor delete.**

---

## 1. What changed

| File | Change |
|---|---|
| `src/app/services/baseline.service.ts` | `deleteBaseline({sensorId, eventId, note?})` / `restoreBaseline({sensorId, eventId})` next to `setBaseline`, + `DeleteBaselineResult` / `RestoreBaselineResult` interfaces matching the deployed contract. |
| `src/app/dialogs/delete-baseline-dialog/` (**new**) | Hebrew RTL dialog, two steps: **details** — date, reason (Hebrew label), by, note, initial values + "מחק בייסליין" (admin only, disabled on the earliest event with tooltip "הבייסליין הראשון של החיישן – לא ניתן למחוק"); **confirm** — the plain-words text ("יימחק הבייסליין מ-‹date› (‹reason›). מ-‹date› והלאה הגרף יחושב מחדש לפי הבייסליין הקודם מ-‹prevDate›."), optional delete note, מחק / ביטול, spinner (recompute can take tens of seconds). Server errors (`failed-precondition` etc.) are shown inline. Also exports `handleBaselineDeleted()` — the shared toast-with-undo + re-fetch flow used by all call sites. |
| `src/app/shared/chart-baseline-markers.ts` | `baselineEventAtPixel(chart, events, x, y)` — hit-test for the canvas-drawn markers (they're an `afterDraw` plugin, not datasets, so clicks need manual hit-testing; 8 px tolerance, same visibility rules as the draw). |
| `prism-chart.component.ts` | Canvas `click` → hit-test → dialog positioned near the click (the "popover"). On success → `refreshDataRequested` + snackbar "הבייסליין נמחק · ‹n› נקודות חושבו מחדש" with **בטל** → `restoreBaseline` → refresh again. |
| `default-chart.component.ts` | Same marker-click flow + added the missing `refreshDataRequested` output (wired in `sensor-chart-main.component.html`). |
| `initial-value.component` (ts/html/scss) | The existing baseline-events list gets a delete icon per row — admin only, earliest/only event disabled with the Hebrew tooltip (span carries the tooltip since disabled buttons don't fire mouse events). Opens the dialog on the confirm step; emits `baselineChanged`. |
| `sensor-cmp.component` (ts/html) | `(baselineChanged)` → `chartComponent.refreshCurrentData()`. |
| `sensor-chart-main.component.ts` | **C1 fix:** `refreshCurrentData()` was dead code — it read `lastValidStartDate`/`lastValidEndDate`, which are **never set anywhere** (that's why "delete point needs Fetch"). Now replays the stored `lastFetchEvent` verbatim — the exact visible range reloads for every rangeMode (`latest` re-derives from the newest `latestRead`). |
| `app.module.ts` | Declared `DeleteBaselineDialogComponent`. |

## 2. Flow (as implemented)

1. Click a purple baseline marker (or the 🗑 icon in the sidebar list) → event details.
2. "מחק בייסליין" → confirm text + optional note → `deleteBaseline` with spinner.
3. On success: chart re-fetches its current range automatically (no manual Fetch), events list updates live (Firestore listener), toast shows recompute count + **בטל**.
4. "בטל" → `restoreBaseline` (spinner snackbar "משחזר את הבייסליין…") → chart re-fetches again.
5. Non-admins see no delete action anywhere; earliest/only event is disabled client-side and refused server-side.

## 3. Verification so far

- `ng build` (Node 12.22.12): ✅ clean.
- `ng build --configuration production`: ✅ clean (only pre-existing bundle-budget warnings).
- Callable contract verified against the deployed `deleteBaseline.ts` — incl. `recompute.written` for the toast and `{error}` on recompute failure.

## 4. Deploy

Preview channel `a3-delete-baseline`, deployed 2026-10-20 ~14:25Z as
`scanin.link@gmail.com` via the ADC-token workaround (same as the functions
team — the local firebase CLI isn't logged in as the ScanIn account):

```
firebase hosting:channel:deploy a3-delete-baseline --expires 14d --only new-scanin-ui \
  --token "$(CLOUDSDK_CONFIG=~/.config/gcloud-scanin gcloud auth application-default print-access-token)"
```

- URL: https://new-scanin-ui--a3-delete-baseline-2pd5r276.web.app (verified 200, serving `main-es2015.ad7cb7db`)
- Live (`new-scanin-ui.web.app`, 2026-10-17 release) untouched.
- The CLI auto-added the channel domain to Firebase Auth `authorizedDomains`, so login works on the preview.

## 5. E2E test — pending (needs an admin browser session)

On a `בדיקות משרד` sensor (any is OK per Hillel):
- [ ] add two baselines → markers appear, sidebar list shows them
- [ ] delete the middle one from the marker popover → chart moves back to the previous baseline **without manual Fetch**; event leaves the sidebar list; toast shows recompute count + בטל
- [ ] בטל → event restored, chart back
- [ ] earliest event: icon/button disabled + tooltip; server refuses too
- [ ] non-admin: no delete actions visible
- [ ] recompute failure case: toast reports server error instead of count

## 6. Open items

- **Not committed** — changes sit in the working tree on `main`. Commit after review.
- `firebase-debug.log` noise from the token-deploy is local only (gitignored?).
