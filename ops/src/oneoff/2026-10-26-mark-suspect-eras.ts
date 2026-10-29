/**
 * Mark stretches that can't be aligned as suspect (suspect_reason "manual-era"): samples on a wrong,
 * internally unstable level (e.g. the station's first setup before 26.02.2025 on NAVON), so the MA and
 * reports skip them. recomputeSmoothing preserves non-evaluator suspect reasons and skips those samples;
 * their stale `smooth` / `eval` are deleted here. Raw values untouched.
 *
 * Backup of the touched fields → out/suspect-eras-backup-<ts>.json. Undo: --restore=<backup> --apply.
 * Usage: npx tsx src/oneoff/2026-10-26-mark-suspect-eras.ts [--apply] | --restore=out/<backup>.json [--apply]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run, str } from "../lib/cli";

const SETUP_NAVON = "2025-02-26T13:00:00Z";
const ERAS = [
  { sensorId: "sen-prism-PRISM_JTCS_H0_8A", name: "NAVON 15", to: SETUP_NAVON },
  { sensorId: "sen-prism-PRISM_JTCS_H0_8B", name: "NAVON 16", to: SETUP_NAVON },
  { sensorId: "sen-prism-PRISM_JTCS_H0_11A", name: "NAVON 21", to: SETUP_NAVON },
  { sensorId: "sen-prism-PRISM_JTCS_H0_11B", name: "NAVON 22", to: SETUP_NAVON },
  { sensorId: "sen-prism-PRISM_JTCS_H0_9B", name: "NAVON 18", to: SETUP_NAVON },
  { sensorId: "sen-prism-prism_JTCS_H2_3F", name: "SAVYON LIVING 3", to: "2025-02-26T13:10:00Z" },
  { sensorId: "sen-prism-prism_JTCS_H2_3F", name: "SAVYON LIVING 3", from: "2026-08-27T06:00:00Z", to: "2026-09-08T15:07:00Z" },
];
const NOTE = "unstable wrong-level stretch, can't be aligned (oneoff 2026-10-26-mark-suspect-eras)";
const FIELDS = ["suspect", "suspect_reason", "suspect_axis", "suspect_note", "smooth", "eval"];

run(async () => {
  const args = parseArgs();
  const w = new BatchWriter();
  if (args.restore) {
    const b = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), String(args.restore)), "utf8"));
    console.log(`restore ${b.docs.length} docs from ${args.restore}`);
    if (!(await confirmApply(args, `restore ${b.docs.length} data-log docs`))) return;
    for (const d of b.docs) await w.update(db.doc(d.path), Object.fromEntries(FIELDS.map((f) => [f, d.before[f] === undefined ? FieldValue.delete() : d.before[f]])));
    await w.flush(); console.log(`✅ ${w.committed} writes`); return;
  }
  const touched: any[] = [];
  for (const e of ERAS) {
    const from = e.from ? Date.parse(e.from) : 0, to = Date.parse(e.to);
    const snap = await db.collection(`work-sensors/${e.sensorId}/data-log`).where("time", ">=", from).where("time", "<", to).get();
    const docs = snap.docs.filter((d) => !d.id.startsWith("daily::") && d.data().suspect_reason !== "manual-era")
      .filter((d) => !(d.data().suspect === true && !["implausible-jump", "out-of-range"].includes(d.data().suspect_reason))); // keep other QC flags
    console.log(`${e.name.padEnd(16)} ${e.from?.slice(0, 10) ?? "start"} → ${e.to.slice(0, 10)}: ${docs.length} samples to mark`);
    docs.forEach((d) => touched.push({ path: d.ref.path, before: Object.fromEntries(FIELDS.map((f) => [f, d.data()[f]])) }));
  }
  if (!(await confirmApply(args, `mark ${touched.length} samples suspect (manual-era)`))) return;
  const file = path.resolve(process.cwd(), `out/suspect-eras-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), docs: touched }));
  console.log(`💾 backup ${file}`);
  for (const t of touched) await w.update(db.doc(t.path), { suspect: true, suspect_reason: "manual-era", suspect_note: NOTE, suspect_axis: FieldValue.delete(), smooth: FieldValue.delete(), eval: FieldValue.delete() });
  await w.flush();
  console.log(`✅ ${w.committed} writes. Then: recompute-smoothing --project=ge8lO1KCbxU4RnpgL7xs,pUeJ6MlE8HwJPV57kETZ --days=all (functions repo)`);
  void str;
});
