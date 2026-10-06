/**
 * Resolve all open late-data notices (Hillel, 2026-10-06).
 *
 * Most of them were raised by retained-MQTT replays (the broker re-delivered old messages on every
 * bridge restart — e.g. Beanair vibration notifications at kaminitz complex, 213 days "behind") or
 * by backlogs that already finished uploading. The retained messages are being cleared and the
 * bridge will ignore retained deliveries; a genuinely late logger re-opens a fresh notice on its
 * next late sample.
 *
 * Sets status 'resolved', resolution 'released', resolvedBy this script. Undo reopens them.
 *
 * Usage (from ops/):
 *   npx tsx src/oneoff/2026-10-06-resolve-stale-late-data.ts            # dry run
 *   npx tsx src/oneoff/2026-10-06-resolve-stale-late-data.ts --apply
 *   npx tsx src/oneoff/2026-10-06-resolve-stale-late-data.ts --undo=out/resolve-late-data-backup-<ts>.json --apply
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run, str } from "../lib/cli";

const BY = "oneoff 2026-10-06-resolve-stale-late-data";

run(async () => {
  const args = parseArgs();
  const outDir = path.resolve(__dirname, "../../out");
  const undo = str(args.undo);
  if (undo) {
    const paths: string[] = JSON.parse(fs.readFileSync(path.resolve(undo), "utf8"));
    if (!(await confirmApply(args, `reopen ${paths.length} late-data notices`))) return;
    const w = new BatchWriter();
    for (const p of paths) await w.update(db.doc(p), { status: "open", resolution: FieldValue.delete(), resolvedBy: FieldValue.delete(), resolvedAt: FieldValue.delete() });
    await w.flush();
    console.log(`✅ undo done: ${w.committed}`);
    return;
  }
  const open = await db.collection("data-integrity").where("status", "==", "open").where("kind", "==", "late-data").get();
  const names = new Map<string, string>();
  for (const d of open.docs) {
    const x = d.data();
    if (!names.has(x.projectId)) names.set(x.projectId, (await db.doc(`projects/${x.projectId}`).get()).data()?.name ?? x.projectId);
    console.log(`  ${String(names.get(x.projectId)).padEnd(32)} ${String(x.details?.daysBehind ?? "?").padStart(6)} days  opened ${x.openedAt?.toDate?.().toISOString().slice(0, 16)}`);
  }
  console.log(`${open.size} open late-data notices`);
  if (!open.size || !(await confirmApply(args, `resolve ${open.size} open late-data notices`))) return;
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `resolve-late-data-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(open.docs.map((d) => d.ref.path), null, 2));
  const w = new BatchWriter();
  for (const d of open.docs) await w.update(d.ref, { status: "resolved", resolution: "released", resolvedBy: BY, resolvedAt: new Date() });
  await w.flush();
  console.log(`✅ done: ${w.committed}. Backup: ${file}`);
});
