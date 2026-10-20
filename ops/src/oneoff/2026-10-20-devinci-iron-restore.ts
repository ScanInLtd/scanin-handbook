/**
 * A4 DeVinci ironing — UNDO: put every backed-up sensor back exactly as it was before ironing
 * (Hillel, 2026-10-20). Input: the backup the apply script wrote first
 * (ops/out/devinci-iron-backup-<ts>.json, see src/lib/iron-backup.ts).
 *
 * Per sensor:
 *   - baseline events added since the backup whose note starts with "iron:" → archived to
 *     baseline-events-deleted (deletedBy / deleteNote "iron restore", like deleteBaseline) and deleted.
 *     Events added since the backup by anything else are listed and left alone.
 *   - backed-up events that are gone or were changed → written back with their original id + data
 *   - initial-value / status / alert_state / thresholds → written back (deleted if absent in the backup)
 *   - every backed-up data-log doc: smooth / eval / suspect / suspect_reason written back exactly
 *     (deleted if absent in the backup); raw fields are never touched
 *   - data-log docs that arrived after the backup are reported, not touched. Their smooth/eval was
 *     computed under the iron baseline: after a restore run
 *     `recompute-smoothing.js --sensor=<id> --days=…` (functions repo) for those sensors.
 *
 * Usage (from ops/):
 *   npx tsx src/oneoff/2026-10-20-devinci-iron-restore.ts --backup=out/devinci-iron-backup-….json            # dry run
 *   npx tsx src/oneoff/2026-10-20-devinci-iron-restore.ts --backup=… --sensor=<id>                           # one sensor
 *   npx tsx src/oneoff/2026-10-20-devinci-iron-restore.ts --backup=… --apply                                 # write (asks "yes")
 */
import { BatchWriter, confirmApply, fmtTime, list, parseArgs, run, str } from "../lib/cli";
import { applyRestore, loadBackup, planRestore, planWrites, type RestorePlan } from "../lib/iron-backup";

const BY = "hillel@scanin (oneoff 2026-10-20-devinci-iron-restore)";

run(async () => {
  const args = parseArgs();
  const file = str(args.backup);
  if (!file) throw new Error("--backup=<ops/out/devinci-iron-backup-….json> required");
  const backup = loadBackup(file);
  const only = new Set(list(args.sensor));
  const sensors = backup.sensors.filter((s) => !only.size || only.has(s.sensorId));
  if (!sensors.length) throw new Error("no matching sensors in the backup");
  console.log(`Backup ${file}\n  created ${backup.createdAt} by ${backup.createdBy}, ${backup.sensors.length} sensors (restoring ${sensors.length})\n`);

  const plans: RestorePlan[] = [];
  for (const s of sensors) {
    const p = await planRestore(s);
    plans.push(p);
    const fields = Object.keys(p.sensorUpdate);
    const logFields: Record<string, number> = {};
    for (const u of p.logUpdates) for (const k of Object.keys(u.set)) logFields[k] = (logFields[k] ?? 0) + 1;
    console.log(`${p.sensorId} "${p.name}" (from ${fmtTime(s.from)})`);
    console.log(`  events: delete ${p.eventsToDelete.length} iron, re-create ${p.eventsToRecreate.length}, rewrite ${p.eventsChanged.length}` +
      (p.eventsForeign.length ? `, ⚠️ ${p.eventsForeign.length} non-iron event(s) added since the backup — left alone` : ""));
    for (const e of p.eventsToDelete) {
      const d = e.data as Record<string, unknown>;
      console.log(`    − ${e.id} time=${fmtTime(d.time)} reason=${d.reason} note=${JSON.stringify(d.note)}`);
    }
    console.log(`  sensor fields: ${fields.length ? fields.join(", ") : "unchanged"}`);
    console.log(`  data-log: ${p.logUpdates.length}/${s.dataLog.length} docs to rewrite ${JSON.stringify(logFields)}` +
      (p.logMissing ? `, ${p.logMissing} gone` : "") +
      (p.logNewSince ? `, ⚠️ ${p.logNewSince} new since the backup (recompute after restore)` : ""));
    for (const u of p.logUpdates.slice(0, 2)) console.log(`    ~ ${u.id} ${JSON.stringify(u.set).slice(0, 160)}`);
  }

  const writes = plans.reduce((n, p) => n + planWrites(p), 0);
  console.log(`\nTOTAL: ${writes} writes across ${plans.filter((p) => planWrites(p) > 0).length}/${plans.length} sensors`);
  if (!writes || !(await confirmApply(args, `restore ${plans.length} sensors from ${file} (${writes} writes)`))) return;

  const w = new BatchWriter();
  for (const p of plans) await applyRestore(p, BY, w);
  await w.flush();
  console.log(`✅ restored: ${w.committed} writes. Re-run without --apply: expect TOTAL 0 writes.`);
});
