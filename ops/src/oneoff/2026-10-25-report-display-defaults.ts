/**
 * Every report gets the DeVinci (REP141) chart display set (Hillel 2026-10-25: "all the work we did for
 * DeVinci should be the default for all reports"):
 *   connectGaps=true, showBaselineMarkers=false, showAlertMarkers=false, useUiScale=true, forceUiScale=true
 *
 * The worker (reports `displayOptions()`) and the report editor now use these as the defaults for a
 * missing field — but the editor has been writing all five fields explicitly on every save since 23.10
 * (with the old defaults), so existing configs are set here. Health reports are skipped (no charts).
 *
 * Backup: out/report-display-defaults-backup-<ts>.json (previous value of each field per config, or
 * "missing"), written before any write. Undo: --undo=<backup> --apply writes them back (deletes the field
 * where it was missing).
 *
 * Usage:
 *   npx tsx src/oneoff/2026-10-25-report-display-defaults.ts                                  # dry run
 *   npx tsx src/oneoff/2026-10-25-report-display-defaults.ts --apply                          # write (asks "yes")
 *   npx tsx src/oneoff/2026-10-25-report-display-defaults.ts --undo=out/report-display-defaults-backup-….json --apply
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run, str } from "../lib/cli";

const DEFAULTS: Record<string, boolean> = {
  connectGaps: true,
  showBaselineMarkers: false,
  showAlertMarkers: false,
  useUiScale: true,
  forceUiScale: true,
};
const FIELDS = Object.keys(DEFAULTS);

run(async () => {
  const args = parseArgs();

  if (str(args.undo)) {
    const backup = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), str(args.undo)!), "utf8"));
    console.log(`undo from ${str(args.undo)}: ${backup.configs.length} configs`);
    if (!(await confirmApply(args, `restore ${FIELDS.join("/")} on ${backup.configs.length} ReportConfig docs`))) return;
    const w = new BatchWriter();
    for (const c of backup.configs) {
      const upd: Record<string, any> = {};
      for (const f of FIELDS) upd[f] = c.before[f] === "missing" ? FieldValue.delete() : c.before[f];
      await w.update(db.collection("ReportConfig").doc(c.id), upd);
    }
    await w.flush();
    console.log(`✅ restored ${backup.configs.length} configs`);
    return;
  }

  const snap = await db.collection("ReportConfig").get();
  const plan: { id: string; name: string; type: string; before: Record<string, any>; changes: string[] }[] = [];
  let skippedHealth = 0, alreadyOk = 0;
  for (const d of snap.docs) {
    const x = d.data();
    if (x.reportType === "health") { skippedHealth++; continue; }
    const before: Record<string, any> = {};
    const changes: string[] = [];
    for (const f of FIELDS) {
      before[f] = x[f] === undefined ? "missing" : x[f];
      if (x[f] !== DEFAULTS[f]) changes.push(`${f}: ${before[f]} → ${DEFAULTS[f]}`);
    }
    if (!changes.length) { alreadyOk++; continue; }
    plan.push({ id: d.id, name: x.reportName || x.name || "", type: x.reportType || "sensor", before, changes });
  }

  console.log(`ReportConfig: ${snap.size} docs · ${plan.length} to update · ${alreadyOk} already on the defaults · ${skippedHealth} health (skipped)`);
  plan.forEach((p) => console.log(`  ${p.id.padEnd(28)} ${String(p.type).padEnd(7)} ${String(p.name).slice(0, 34).padEnd(34)}  ${p.changes.join(", ")}`));
  if (!plan.length || !(await confirmApply(args, `set ${FIELDS.join("/")} to the DeVinci defaults on ${plan.length} ReportConfig docs`))) return;

  const file = path.resolve(__dirname, `../../out/report-display-defaults-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), defaults: DEFAULTS, configs: plan }, null, 1));
  if (!fs.existsSync(file)) throw new Error("backup not written — aborting");
  console.log(`💾 backup ${file}`);

  const w = new BatchWriter();
  for (const p of plan) await w.update(db.collection("ReportConfig").doc(p.id), { ...DEFAULTS });
  await w.flush();
  console.log(`✅ ${plan.length} configs updated`);
});
