/**
 * Per-project rollout flags (signal-and-alerts Phase 4 + axes X4). Approved by Hillel 2026-10-05.
 *
 *   projects/{id}.alerting   = 'v2'        → two-tier alerts (smooth-based) drive status + alerts
 *   projects/{id}.prismAxes  = 'registry'  → prisms alert on E/N/H (registry), TwoD no longer evaluated
 *
 * When prismAxes switches to 'registry', TwoD stops being evaluated, so its current status would stay
 * frozen forever. For every prism of the project this script also deletes
 * status.axes.TwoDDisplacement and alert_state.axes.TwoDDisplacement (backed up).
 *
 * Usage:
 *   npx tsx src/oneoff/2026-10-05-project-flags.ts --project=<id> [--alerting=v2] [--prismAxes=registry]   # dry run
 *   … --apply                                                                                                # write
 *   npx tsx src/oneoff/2026-10-05-project-flags.ts --undo=out/project-flags-backup-<ts>.json --apply
 *
 * Undo: restores every touched field from the backup file (fields that didn't exist are deleted).
 * Instant kill-switch without this script: delete the project field (alerting / prismAxes).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run, str } from "../lib/cli";
import { projectName } from "../lib/sensors";

type Backup = { path: string; fields: Record<string, unknown> };
const getPath = (o: any, p: string) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

run(async () => {
  const args = parseArgs();
  const outDir = path.resolve(__dirname, "../../out");

  const undoFile = str(args.undo);
  if (undoFile) {
    const backups: Backup[] = JSON.parse(fs.readFileSync(path.resolve(undoFile), "utf8"));
    backups.forEach((b) => console.log(`  restore ${b.path}: ${JSON.stringify(b.fields)}`));
    if (!(await confirmApply(args, `restore ${backups.length} docs (project flags undo)`))) return;
    const w = new BatchWriter();
    for (const b of backups)
      await w.update(db.doc(b.path), Object.fromEntries(Object.entries(b.fields).map(([k, v]) => [k, v === undefined || v === null ? FieldValue.delete() : v])));
    await w.flush();
    console.log(`✅ undo done: ${w.committed} docs`);
    return;
  }

  const projectId = str(args.project);
  if (!projectId) throw new Error("--project=<id> required");
  const alerting = str(args.alerting);
  const prismAxes = str(args.prismAxes);
  if (alerting && alerting !== "v2") throw new Error("--alerting must be v2");
  if (prismAxes && prismAxes !== "registry") throw new Error("--prismAxes must be registry");
  if (!alerting && !prismAxes) throw new Error("nothing to set: pass --alerting=v2 and/or --prismAxes=registry");

  const pref = db.collection("projects").doc(projectId);
  const p = await pref.get();
  if (!p.exists) throw new Error(`project ${projectId} not found`);
  const pd = p.data()!;
  console.log(`Project: ${projectName(pd)} (${projectId})  current alerting=${pd.alerting ?? "-"} prismAxes=${pd.prismAxes ?? "-"}`);

  const plan: { ref: DocumentReference; data: Record<string, unknown>; backup: Backup; note: string }[] = [];
  const pdata: Record<string, unknown> = {};
  if (alerting) pdata.alerting = alerting;
  if (prismAxes) pdata.prismAxes = prismAxes;
  plan.push({
    ref: pref, data: pdata,
    backup: { path: pref.path, fields: Object.fromEntries(Object.keys(pdata).map((k) => [k, pd[k] ?? null])) },
    note: `project: set ${JSON.stringify(pdata)}`,
  });

  if (prismAxes) {
    const prisms = await db.collection("work-sensors").where("location.site", "==", projectId).where("type", "==", "prism").get();
    for (const d of prisms.docs) {
      const x = d.data();
      const fields = ["status.axes.TwoDDisplacement", "alert_state.axes.TwoDDisplacement"].filter((f) => getPath(x, f) !== undefined);
      if (!fields.length) continue;
      plan.push({
        ref: d.ref,
        data: Object.fromEntries(fields.map((f) => [f, FieldValue.delete()])),
        backup: { path: d.ref.path, fields: Object.fromEntries(fields.map((f) => [f, getPath(x, f)])) },
        note: `prism ${d.id} "${x.name ?? ""}": clear TwoD status (was ${JSON.stringify(x.status?.axes?.TwoDDisplacement ?? null)})`,
      });
    }
  }

  console.log(`\nPlanned writes: ${plan.length}`);
  plan.forEach((x) => console.log(`  • ${x.note}`));
  if (!(await confirmApply(args, `${projectName(pd)}: ${JSON.stringify(pdata)} (+${plan.length - 1} TwoD status clears)`))) return;

  fs.mkdirSync(outDir, { recursive: true });
  const backupFile = path.join(outDir, `project-flags-backup-${projectId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(plan.map((x) => x.backup), null, 2));
  console.log(`Backup: ${backupFile}`);
  const w = new BatchWriter();
  for (const x of plan) await w.update(x.ref, x.data);
  await w.flush();
  console.log(`✅ done: ${w.committed} writes. Undo: --undo=${path.relative(process.cwd(), backupFile)} --apply`);
});
