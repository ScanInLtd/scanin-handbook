# Feedback: `scanin-svc-firebase-functions` — A3 Section 1: `deleteBaseline` + `restoreBaseline` callables

**Date:** 2026-10-20
**Repo:** scanin-svc-firebase-functions
**Task:** [`docs/work-plan/tasks/A3-delete-baseline.md`](../../work-plan/tasks/A3-delete-baseline.md) §"Section 1"
**Status:** ✅ implemented + emulator-tested **28/28**, committed **`f691fa2`** on `master` (not pushed). **NOT deployed — awaiting approval.**

---

## 1. What changed

| File | Content |
|---|---|
| `src/deleteBaseline.ts` (new) | `deleteBaseline` + `restoreBaseline` callables (onCall v2, admin `admin`/`isAdmin` — same check as `setBaseline`, same default region, 512 MiB / 300 s). Both cores (`deleteBaselineCore`, `restoreBaselineCore`) are exported separately so tests and a future bulk wrapper (station-wide delete, "not in scope") can reuse them. |
| `src/index.ts` | Exports both callables. |
| `scripts/test-delete-baseline-emulator.js` (new) | 28-check acceptance suite. Runs against the **Firestore emulator only** — cores are called directly, so no function triggers / sleeps; fully deterministic. |

## 2. Behavior (as implemented)

`deleteBaseline({ sensorId, eventId, note? })`:

1. Loads the sensor + all `baseline-events` (ordered by `time`).
2. Refuses with `failed-precondition` when: the event doesn't exist · it's the **only** event · it's the **earliest** event (message explains it holds the original zero). Missing sensor → `not-found`.
3. One batch: copies the event to `baseline-events-deleted/{eventId}` with `deletedAt` (server ts), `deletedBy`, `deleteNote`; deletes the live doc.
4. Re-mirrors `initial-value` = `initial` of the latest **remaining** event.
5. Resets `status.axes` → ok and `alert_state.axes` → `{}` (same union-of-axes logic as `setBaseline`). Notices untouched, per spec.
6. `recomputeSmoothingCore({ sensorId, fromTime: deletedEvent.time, apply: true })`; a failure is caught and reported, never undoes the delete.
7. One log line + returns `{ deleted: {eventId, time, reason}, initialValue, recompute }`.

`restoreBaseline({ sensorId, eventId })` — the undo:

- Refuses: no archived doc → `not-found`; already restored → `failed-precondition`; a live doc with that id exists → `failed-precondition`.
- **Deviation from the letter of the spec:** "move the doc back" is implemented as *copy back + keep the archive doc*, marked `restoredAt`/`restoredBy`. The restored event doc is byte-identical to the pre-delete one (all delete/restore metadata stays only on the archive copy), so the archive remains the audit trail of the whole delete/restore cycle. A second delete of the same event overwrites the archive cleanly.
- Then steps 4–6 with the restored event's time; returns `{ restored: {eventId, time, reason}, initialValue, recompute }`.

## 3. Emulator results — 28/28 ✅

`FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=demo-scanin node scripts/test-delete-baseline-emulator.js`
(emulator start: `firebase emulators:start --only firestore --project demo-scanin`; needs a JDK — used `JAVA_HOME=/opt/homebrew/opt/openjdk@17`)

| Case | Checks |
|---|---|
| A. delete middle event | archive doc written (original fields + `deletedAt`/`deletedBy`/`deleteNote`), live doc gone; `initial-value` unchanged (deleted event wasn't latest); `status.axes` → ok and `alert_state.axes` → {} (both seeded dirty); era-2 samples re-evaluated on the **previous** event's baseline (raw 100 → eval `alarm`, last smooth ≈ 100 vs ≈ 0 before); era-3 untouched; post-delete recompute dry-run `wouldChange = 0` |
| B. delete latest event | `initial-value` re-mirrors the new latest (100 → 0), sensor doc + return value agree |
| C. refusals | nonexistent event / only event / earliest event → `failed-precondition`, missing sensor → `not-found`; refused deletes wrote nothing (no archive docs, events intact) |
| D. restore | event doc **identical** to pre-delete (incl. `createdAt`); `baseline-events` holds ev1+ev2+ev3 ordered; archive kept marked `restoredAt`/`restoredBy`; `initial-value` back to latest; `smooth`/`eval`/`suspect` on every data-log doc **identical** to the pre-delete converged snapshot; dry-run `wouldChange = 0`; second restore → `failed-precondition`, never-deleted event → `not-found` |

## 4. Deploy plan (on approval)

```
firebase deploy --only functions:deleteBaseline,functions:restoreBaseline
```

Two new callables; **no existing function changes** (index.ts only adds exports — the other functions' codepaths are untouched). No new Firestore indexes needed (`baseline-events`/`baseline-events-deleted` are single-field `time` queries). `baseline-events-deleted` is a new subcollection — no rules change needed: the deployed rules (web-platform file) match `work-sensors/{id}/{subcollection}/{docId}` with a wildcard, so it inherits the same project-access rule as `baseline-events`, and the functions use the Admin SDK (rules bypassed) regardless.

**Rollback:** delete the two functions (`firebase functions:delete deleteBaseline restoreBaseline` or redeploy `4579e86`). Archived docs in `baseline-events-deleted` are inert; restores already applied are real events again.

## 5. Notes for Section 2 (web-platform)

- Client callables: `deleteBaseline` / `restoreBaseline`, region = default (`us-central1`), same as `setBaseline`.
- UI should pre-disable delete on the earliest event (first by `time`) — the server refuses it anyway with `failed-precondition` and a clear message.
- `restoreBaseline` returns the same shape (`restored` instead of `deleted`) — the undo toast can reuse the result's `recompute.written` for "‹n› נקודות חושבו מחדש".
- `recompute` in the result is `RecomputeStats | { error }` — check `.error` before reading stats.
