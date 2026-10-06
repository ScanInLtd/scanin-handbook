/**
 * Prism axis registry: X / Y / Z labels, TwoD off everywhere (Hillel, 2026-10-06).
 *
 * The prism "East / North" axes are the station's local frame, not geographic
 * east/north, so the labels were misleading. The registry is the only place these
 * labels live (UI tabs/editor, alert texts, v2 reports all read it), so this one
 * write renames them everywhere:
 *   EastingDisplacement  → "תזוזה X" / "X displacement"
 *   NorthingDisplacement → "תזוזה Y" / "Y displacement"
 *   HeightDisplacement   → "תזוזה Z" / "Z displacement"
 * TwoDDisplacement: chart=false, report=false, alertable=false (no UI tab, no
 * report chart, no alerts). Field names, data and thresholds are untouched.
 * Alerts created before the change keep their stored axisLabel.
 *
 * Usage (from ops/):
 *   npx tsx src/oneoff/2026-10-06-prism-axis-labels.ts             # dry run
 *   npx tsx src/oneoff/2026-10-06-prism-axis-labels.ts --apply     # write (asks "yes")
 *   npx tsx src/oneoff/2026-10-06-prism-axis-labels.ts --undo --apply
 *
 * Undo: the previous values of the touched axis fields are saved to
 * out/prism-axis-labels-backup-<ts>.json; --undo restores the latest backup.
 */
import fs from "fs";
import path from "path";
import { db } from "../lib/firebase";
import { confirmApply, parseArgs, run } from "../lib/cli";

const DOC = "devices-types/sensors/devices/prism";
const CHANGES: Record<string, Record<string, unknown>> = {
  EastingDisplacement: { label: { he: "תזוזה X", en: "X displacement" } },
  NorthingDisplacement: { label: { he: "תזוזה Y", en: "Y displacement" } },
  HeightDisplacement: { label: { he: "תזוזה Z", en: "Z displacement" } },
  TwoDDisplacement: { chart: false, report: false, alertable: false },
};
const OUT = path.join(__dirname, "../../out");

run(async () => {
  const args = parseArgs();
  const ref = db.doc(DOC);
  const axes = (await ref.get()).data()?.axes;
  if (!axes) throw new Error(`${DOC} has no axes map`);

  let updates: Record<string, unknown> = {};
  if (args.undo) {
    const backups = fs.readdirSync(OUT).filter((f) => f.startsWith("prism-axis-labels-backup-")).sort();
    if (!backups.length) throw new Error("no backup found in out/");
    const backup = JSON.parse(fs.readFileSync(path.join(OUT, backups[backups.length - 1]), "utf8"));
    console.log(`UNDO from ${backups[backups.length - 1]}`);
    for (const [axis, fields] of Object.entries<Record<string, unknown>>(backup))
      for (const [k, v] of Object.entries(fields)) updates[`axes.${axis}.${k}`] = v;
  } else {
    for (const [axis, fields] of Object.entries(CHANGES))
      for (const [k, v] of Object.entries(fields)) updates[`axes.${axis}.${k}`] = v;
  }

  console.log(`${DOC}:`);
  for (const [k, v] of Object.entries(updates)) {
    const [, axis, field] = k.split(".");
    console.log(`  ${k.padEnd(40)} ${JSON.stringify(axes[axis]?.[field])} → ${JSON.stringify(v)}`);
  }

  if (!(await confirmApply(args, `${args.undo ? "restore" : "update"} ${Object.keys(updates).length} prism axis fields`))) return;

  if (!args.undo) {
    const backup: Record<string, Record<string, unknown>> = {};
    for (const [axis, fields] of Object.entries(CHANGES))
      backup[axis] = Object.fromEntries(Object.keys(fields).map((k) => [k, axes[axis]?.[k] ?? null]));
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `prism-axis-labels-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`backup: ${file}`);
  }
  await ref.update(updates);
  const after = (await ref.get()).data()?.axes;
  for (const axis of Object.keys(CHANGES)) console.log(`  ✅ ${axis}: ${JSON.stringify(after[axis])}`);
});
