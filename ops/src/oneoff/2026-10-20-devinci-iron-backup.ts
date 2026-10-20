/**
 * A4 DeVinci ironing — backup of every sensor the ironing will touch (Hillel, 2026-10-20).
 * READ-ONLY on Firestore: it only writes the local file ops/out/devinci-iron-backup-<ts>.json.
 *
 * The apply script calls the same `writeBackup()` (src/lib/iron-backup.ts) as its FIRST step and
 * stops if it throws. This CLI exists to take a backup by hand, test the restore, and size it.
 *
 * Usage (from ops/):
 *   npx tsx src/oneoff/2026-10-20-devinci-iron-backup.ts --plan=out/devinci-iron-plan.json
 *   npx tsx src/oneoff/2026-10-20-devinci-iron-backup.ts --sensor=<id>[,<id>] --from=2026-08-15
 *   npx tsx src/oneoff/2026-10-20-devinci-iron-backup.ts --project=<id> --type=prism --from=2026-08-15 --estimate
 *
 * --plan     plan JSON from 2026-10-20-devinci-iron.ts: [{ id|sensorId, time }, …] (or { plan: [...] });
 *            per sensor `from` = its earliest planned event time
 * --estimate collect but don't write the file; print the size it would have
 * Restore:   src/oneoff/2026-10-20-devinci-iron-restore.ts --backup=<file>
 */
import * as fs from "node:fs";
import { db } from "../lib/firebase";
import { list, parseArgs, parseWhen, run, str } from "../lib/cli";
import { collectSensor, writeBackup } from "../lib/iron-backup";

run(async () => {
  const args = parseArgs();
  let targets: Array<{ sensorId: string; from: number }> = [];

  if (str(args.plan)) {
    const raw = JSON.parse(fs.readFileSync(str(args.plan)!, "utf8"));
    const rows: Array<{ id?: string; sensorId?: string; time: number }> = Array.isArray(raw) ? raw : raw.plan;
    const from = new Map<string, number>();
    for (const r of rows) {
      const id = r.sensorId ?? r.id!;
      from.set(id, Math.min(from.get(id) ?? Infinity, r.time));
    }
    targets = [...from].map(([sensorId, f]) => ({ sensorId, from: f }));
  } else {
    const from = parseWhen(str(args.from), NaN);
    if (!Number.isFinite(from)) throw new Error("--from=<YYYY-MM-DD> required (or --plan=)");
    let ids = list(args.sensor);
    if (str(args.project)) {
      const snap = await db.collection("work-sensors").where("location.site", "==", str(args.project)).get();
      ids = snap.docs.filter((s) => s.data().active !== false && (!str(args.type) || s.data().type === str(args.type))).map((s) => s.id);
    }
    if (!ids.length) throw new Error("--sensor=, --project= or --plan= required");
    targets = ids.map((sensorId) => ({ sensorId, from }));
  }

  if (args.estimate) {
    let bytes = 0, docs = 0, events = 0;
    for (const t of targets) {
      const s = await collectSensor(t.sensorId, t.from);
      bytes += Buffer.byteLength(JSON.stringify(s));
      docs += s.dataLog.length;
      events += s.baselineEvents.length;
    }
    console.log(`ESTIMATE: ${targets.length} sensors, ${events} baseline events, ${docs} data-log docs → ${(bytes / 1024).toFixed(0)} KiB (no file written)`);
    return;
  }

  const r = await writeBackup(targets, "oneoff 2026-10-20-devinci-iron-backup");
  console.log(`✅ backup written + verified: ${r.file}`);
  console.log(`   ${r.sensors} sensors, ${r.events} baseline events, ${r.docs} data-log docs, ${(r.bytes / 1024).toFixed(0)} KiB, sha256 ${r.sha256.slice(0, 16)}…`);
});
