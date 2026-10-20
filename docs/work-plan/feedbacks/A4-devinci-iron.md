# Feedback — A4 DeVinci ironing

**Task:** [`../tasks/A4-devinci-iron.md`](../tasks/A4-devinci-iron.md)

> **Status 2026-10-20:** only the **"Backup before apply"** section is delivered (inbox note `20261020-1600-devinci-iron-backup.md`). The inventory, groups, classification, `2026-10-20-devinci-iron.ts` plan, and apply script are **not written yet**. The apply script must use the backup contract below.
> Nothing was written to production. The only Firestore access was read-only (backup collection, size estimate, restore dry-runs).

## Backup / restore design

| file | what |
|---|---|
| `ops/src/lib/iron-backup.ts` | `writeBackup`, `loadBackup`, `planRestore` (read-only diff), `applyRestore` (writes) |
| `ops/src/oneoff/2026-10-20-devinci-iron-backup.ts` | CLI: take a backup by hand (`--plan=` / `--sensor=` / `--project= --type=`), or `--estimate` (no file) |
| `ops/src/oneoff/2026-10-20-devinci-iron-restore.ts` | the undo. Dry-run by default; `--apply` asks for "yes" |
| `ops/src/oneoff/2026-10-20-devinci-iron-restore-emulator-test.ts` | emulator round trip (iron with the real functions core, then restore) |

**Backup** (`ops/out/devinci-iron-backup-<ISO-ts>.json`, gitignored), per sensor:
- the sensor doc's `initial-value`, `status`, `alert_state`, `thresholds`. A field missing from the doc is missing in the backup too, so the restore deletes it.
- all `baseline-events` (id + full data)
- every `data-log` doc with `time >= from` (`from` = that sensor's earliest planned event): id, time, and `smooth`, `eval`, `suspect`, `suspect_reason`. Raw values aren't copied because ironing never changes them.
- Timestamps are encoded as `{"__ts":[s,ns]}` and written back exactly. Any other non-JSON type makes the backup **throw** rather than lose data.
- **Verification:** the file is re-read and compared by sha256, then JSON-parsed with sensor and doc counts checked. `writeBackup` throws on any failure.

**Contract for the apply script** (step 1, before any `applyBaseline`):
```ts
import { writeBackup } from "../lib/iron-backup";
const bk = await writeBackup(planTargets /* [{ sensorId, from: earliest planned event time }] */, BY);
console.log(`backup ${bk.file} (${bk.docs} docs, sha256 ${bk.sha256.slice(0, 12)})`);
// throws → run() exits 1 → no event is applied
```
Every event the apply script adds must have a note starting with **`iron:`** (the task already says `note: 'iron: <group>'`). The restore deletes only those.

**Restore**, per sensor in the backup (optionally `--sensor=`):
1. Baseline events added since the backup with note `iron:…` are archived to `baseline-events-deleted` (`deletedBy`, `deleteNote: "iron restore"`, the same audit trail as `deleteBaseline`) and then deleted. Events added since the backup by anything else are **listed and left alone**.
2. Backed-up events that are gone or changed are written back with their original id and data.
3. The 4 sensor fields are written back (or deleted if absent in the backup).
4. For each backed-up data-log doc that differs, `smooth`/`eval`/`suspect`/`suspect_reason` are written back exactly. Only differing docs are written.
5. Docs that arrived after the backup are reported as "new since the backup". Their smooth was computed under the iron baseline, so run `recompute-smoothing.js --sensor=<id>` for them after the restore.

After `--apply`, re-running the dry-run must show `TOTAL: 0 writes`.

## Estimated backup size

Read-only `--estimate`, from 2026-08-15 (the task's inventory start, an upper bound; the real `from` is each sensor's earliest planned event):

| scope | sensors | baseline events | data-log docs | size |
|---|---|---|---|---|
| all active prisms of `hmPh7Hg2fjTc9GyNRDYO` | 99 | 187 | 18,393 | **≈ 3.7 MiB** |

That's about 0.2 KiB per doc. Collection costs about 18.6k reads (≈ $0.01) and takes under a minute. The restore writes only the docs that differ, which is at most the ironed windows.

## Restore tested

**1. Dry-run on a `בדיקות משרד` sensor (production, read-only):** `TpBBTzPKK3BnoIWuveeL` "loadcell 100 gr" (project `j7prfbs8Mord8g4cgNb5`). The project has no prisms, and the mechanism is type-agnostic.
- Backup from 2026-08-15: `ops/out/devinci-iron-backup-2026-10-20T13-39-29-879Z.json`, 1 sensor, 1 event, 677 docs, 84 KiB, verified.
- Restore dry-run against the live state: **`TOTAL: 0 writes`** (the state equals the backup).
- Restore dry-run with a **tampered copy** of the backup, to prove each diff path is detected without writing:

  | tampered | restore plan |
  |---|---|
  | `initial-value` field changed | `sensor fields: initial-value` |
  | an event's note changed | `rewrite 1` |
  | an extra event that no longer exists | `re-create 1` |
  | a doc's `smooth` changed | rewrite `smooth` |
  | a doc gets `suspect`/`suspect_reason` | rewrite both |
  | a doc's `eval` removed | `eval: "__delete"` |

  Result: `TOTAL: 6 writes`, exactly the tampered items, and nothing was written.

**2. Full round trip on the Firestore emulator** (`--apply` path; the only place the restore actually wrote):

- **Setup:** a sensor with a temporary −14 mm step (8 d → 14 d).
- **Run:** `writeBackup`, then iron with the **real** functions `applyBaseline` (an `iron:` event at the step start with the 24 h median, and one at the step end). That recomputed 144 docs. Then `applyRestore`.
- **Results: 8/8 passed.**
  - The ironing changed the state (2 iron events; smooth/eval/status/alert_state rewritten).
  - After the restore: 0 writes left.
  - Events, sensor fields, and data-log fields are byte-identical to the backup.
  - Both iron events are archived with `deleteNote: "iron restore"`.
  - A fresh recompute gives `wouldChange = 0`.

## Not done

- Neither script was run with `--apply` against production, and no backup of the DeVinci prisms was taken. Per the note, `writeBackup` is the apply script's first step.
- The A4 inventory, plan, apply script, and report (task §1–5) are still open.
