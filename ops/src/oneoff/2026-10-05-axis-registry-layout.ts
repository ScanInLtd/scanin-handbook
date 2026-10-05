/**
 * Axis registry: declare each type's chart layout and alert rule (docs/signal-and-alerts/axes.md §4.5).
 *
 * Vibration types aren't "one time series per axis". They use a DIN 4150-3 layout and their own
 * evaluation. Instead of every repo guessing from the type name, every type with a registry gets:
 *   chartLayout: "timeseries" | "din4150" | "vibration-vf"
 *   alertRule:   "thresholds" | "din4150"
 * (merge on devices-types/sensors/devices/{type}; no other field touched; no behavior change until
 * the UI / functions / reports read it).
 *
 * Usage:
 *   npx tsx src/oneoff/2026-10-05-axis-registry-layout.ts            # dry run
 *   npx tsx src/oneoff/2026-10-05-axis-registry-layout.ts --apply    # write (asks "yes")
 *   npx tsx src/oneoff/2026-10-05-axis-registry-layout.ts --undo --apply
 *
 * Undo: --undo deletes both fields again on every type this script would touch (they didn't exist
 * before 2026-10-05).
 */
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run } from "../lib/cli";

const SPECIAL: Record<string, { chartLayout: string; alertRule: string }> = {
  vibration: { chartLayout: "din4150", alertRule: "din4150" },
  "vibration-din": { chartLayout: "din4150", alertRule: "din4150" },
  vibration_vf: { chartLayout: "vibration-vf", alertRule: "thresholds" }, // velocity threshold, own chart
};
const DEFAULT = { chartLayout: "timeseries", alertRule: "thresholds" };

run(async () => {
  const args = parseArgs();
  const snap = await db.collection("devices-types/sensors/devices").get();
  const docs = snap.docs.filter((d) => d.data().axes); // only types that have a registry
  const plan = docs.map((d) => ({ ref: d.ref, type: d.id, before: { chartLayout: d.data().chartLayout, alertRule: d.data().alertRule }, after: SPECIAL[d.id] ?? DEFAULT }));

  console.log(`${args.undo ? "UNDO — delete" : "Set"} chartLayout / alertRule on ${plan.length} types:`);
  plan.forEach((p) => console.log(`  ${p.type.padEnd(26)} ${JSON.stringify(p.before)} → ${args.undo ? "(deleted)" : JSON.stringify(p.after)}`));
  const skipped = snap.docs.filter((d) => !d.data().axes).map((d) => d.id);
  if (skipped.length) console.log(`  (no registry, skipped: ${skipped.join(", ")})`);

  if (!plan.length || !(await confirmApply(args, `${args.undo ? "delete" : "set"} chartLayout/alertRule on ${plan.length} devices-types docs`))) return;
  const w = new BatchWriter();
  for (const p of plan)
    await w.update(p.ref, args.undo ? { chartLayout: FieldValue.delete(), alertRule: FieldValue.delete() } : p.after);
  await w.flush();
  console.log(`✅ done: ${w.committed} docs`);
});
