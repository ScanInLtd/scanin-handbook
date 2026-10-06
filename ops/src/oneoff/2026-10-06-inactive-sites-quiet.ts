/**
 * Quiet the sensors of closed sites (Hillel, 2026-10-06).
 *
 * Projects with isActive === false still have sensors with active !== false. When a device writes
 * into them (e.g. ים המלח תנור, closed ~2 years: 6 strain gauges got samples stamped 2025-02-24 on
 * 2026-10-05 20:59), functions evaluate them and open late-data notices → WhatsApp group noise.
 * functions already skip sensors with active === false (SKIP-INACTIVE: no alerts, no notices;
 * smoothing still written).
 *
 * This oneoff:
 *  1. sets active: false (+ deactivatedBy / deactivatedAt) on every sensor of an inactive project
 *     that isn't already active === false;
 *  2. resolves their open data-integrity notices (resolution 'released', resolvedBy this script).
 * Raw data, thresholds and mappings are untouched. Undo restores the previous `active` values and
 * reopens the notices.
 *
 * Usage (from ops/):
 *   npx tsx src/oneoff/2026-10-06-inactive-sites-quiet.ts                    # dry run
 *   npx tsx src/oneoff/2026-10-06-inactive-sites-quiet.ts --apply
 *   npx tsx src/oneoff/2026-10-06-inactive-sites-quiet.ts --undo=out/inactive-sites-quiet-backup-<ts>.json --apply
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run, str } from "../lib/cli";

type Backup = { sensors: { path: string; active: unknown }[]; notices: string[] };

run(async () => {
  const args = parseArgs();
  const outDir = path.resolve(__dirname, "../../out");
  const undo = str(args.undo);
  if (undo) {
    const b: Backup = JSON.parse(fs.readFileSync(path.resolve(undo), "utf8"));
    if (!(await confirmApply(args, `restore ${b.sensors.length} sensors + reopen ${b.notices.length} notices`))) return;
    const w = new BatchWriter();
    for (const s of b.sensors) await w.update(db.doc(s.path), { active: s.active ?? FieldValue.delete(), deactivatedBy: FieldValue.delete(), deactivatedAt: FieldValue.delete() });
    for (const n of b.notices) await w.update(db.doc(n), { status: "open", resolution: FieldValue.delete(), resolvedBy: FieldValue.delete(), resolvedAt: FieldValue.delete() });
    await w.flush();
    console.log(`✅ undo done: ${w.committed}`);
    return;
  }

  const projects = (await db.collection("projects").get()).docs.filter((p) => (p.data().isActive ?? p.data().active) === false);
  const backup: Backup = { sensors: [], notices: [] };
  const perProject: string[] = [];
  for (const p of projects) {
    const sensors = await db.collection("work-sensors").where("location.site", "==", p.id).get();
    const toQuiet = sensors.docs.filter((s) => s.data().active !== false);
    let notices = 0;
    for (const s of toQuiet) backup.sensors.push({ path: s.ref.path, active: s.data().active ?? null });
    const open = await db.collection("data-integrity").where("projectId", "==", p.id).where("status", "==", "open").get();
    open.docs.forEach((n) => backup.notices.push(n.ref.path));
    notices = open.size;
    if (toQuiet.length || notices) perProject.push(`  ${String(p.data().name).padEnd(40)} sensors ${String(toQuiet.length).padStart(3)} / ${sensors.size}   open notices ${notices}`);
  }
  console.log(`${projects.length} inactive projects; ${backup.sensors.length} sensors to set active:false; ${backup.notices.length} open notices to resolve`);
  perProject.forEach((l) => console.log(l));
  if (!(backup.sensors.length + backup.notices.length) || !(await confirmApply(args, `quiet ${backup.sensors.length} sensors of closed sites + resolve ${backup.notices.length} notices`))) return;

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `inactive-sites-quiet-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  const now = Date.now();
  const w = new BatchWriter();
  for (const s of backup.sensors) await w.update(db.doc(s.path), { active: false, deactivatedBy: "oneoff 2026-10-06-inactive-sites-quiet", deactivatedAt: now });
  for (const n of backup.notices) await w.update(db.doc(n), { status: "resolved", resolution: "released", resolvedBy: "oneoff 2026-10-06-inactive-sites-quiet", resolvedAt: new Date(now) });
  await w.flush();
  console.log(`✅ done: ${w.committed} writes. Backup: ${file}`);
});
