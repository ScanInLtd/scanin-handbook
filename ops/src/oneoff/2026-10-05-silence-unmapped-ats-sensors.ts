/**
  * ⚠️ NOT APPLIED (Hillel 2026-10-05: handle with Nathan in a mapping session instead). Kept for reference.
 *
 * Silence the auto-created, unmapped ATS sensors at מגדל דה וינצי דרום (name "ATS.DeVinci-1.*").
 *
 * After 2026-10-05 renames on the ATS-5 PC, the bridge auto-created 48 sensors "ATS.DeVinci-1.<point>".
 * They got the bridge default thresholds (4/6 mm on E/N/H/TwoD) and no real baseline, so their
 * values are offsets of 10–40 mm. With v2 + prismAxes=registry they produced 50 of the 53 alerts
 * on 2026-10-05 (32 of them on active=false sensors). Until Nathan maps each point to its real UI
 * sensor (questions-for-nathan.md §3), these sensors must not alert.
 *
 * Deletes thresholds.axes, status.axes and alert_state.axes on those sensors (backed up). Raw data,
 * smooth and the sensor docs are untouched.
 *
 * Usage:
 *   npx tsx src/oneoff/2026-10-05-silence-unmapped-ats-sensors.ts            # dry run
 *   npx tsx src/oneoff/2026-10-05-silence-unmapped-ats-sensors.ts --apply
 *   npx tsx src/oneoff/2026-10-05-silence-unmapped-ats-sensors.ts --undo=out/silence-ats-backup-<ts>.json --apply
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run, str } from "../lib/cli";

const PROJECT = "hmPh7Hg2fjTc9GyNRDYO";
const PREFIX = "ATS.DeVinci-1.";
const FIELDS = ["thresholds.axes", "status.axes", "alert_state.axes"];
const getPath = (o: any, p: string) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

run(async () => {
  const args = parseArgs();
  const outDir = path.resolve(__dirname, "../../out");
  const undoFile = str(args.undo);
  if (undoFile) {
    const backups: { path: string; fields: Record<string, unknown> }[] = JSON.parse(fs.readFileSync(path.resolve(undoFile), "utf8"));
    if (!(await confirmApply(args, `restore ${backups.length} sensors`))) return;
    const w = new BatchWriter();
    for (const b of backups) await w.update(db.doc(b.path), Object.fromEntries(Object.entries(b.fields).map(([k, v]) => [k, v ?? FieldValue.delete()])));
    await w.flush();
    console.log(`✅ undo done: ${w.committed}`);
    return;
  }

  const snap = await db.collection("work-sensors").where("location.site", "==", PROJECT).get();
  const targets = snap.docs.filter((d) => String(d.data().name ?? "").startsWith(PREFIX));
  const plan = targets
    .map((d) => {
      const x = d.data();
      const present = FIELDS.filter((f) => getPath(x, f) !== undefined);
      return { ref: d.ref, name: x.name, active: x.active, present, backup: { path: d.ref.path, fields: Object.fromEntries(present.map((f) => [f, getPath(x, f)])) }, status: JSON.stringify(x.status?.axes ?? {}) };
    })
    .filter((p) => p.present.length);
  console.log(`${targets.length} "${PREFIX}*" sensors; ${plan.length} to silence:`);
  plan.forEach((p) => console.log(`  ${p.name.padEnd(28)} active=${p.active}  status=${p.status}`));
  if (!plan.length || !(await confirmApply(args, `delete thresholds/status/alert_state axes on ${plan.length} unmapped ATS sensors`))) return;

  fs.mkdirSync(outDir, { recursive: true });
  const backupFile = path.join(outDir, `silence-ats-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(plan.map((p) => p.backup), null, 2));
  const w = new BatchWriter();
  for (const p of plan) await w.update(p.ref, Object.fromEntries(p.present.map((f) => [f, FieldValue.delete()])));
  await w.flush();
  console.log(`✅ done: ${w.committed}. Backup: ${backupFile}`);
});
