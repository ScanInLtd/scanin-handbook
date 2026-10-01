/**
 * TEMPLATE for a maintenance script that WRITES. Copy to src/oneoff/YYYY-MM-DD-<what>.ts.
 *
 * <One paragraph: what is wrong, why this fixes it, who asked for it, ticket/thread link.>
 *
 * Usage:
 *   npx tsx src/oneoff/YYYY-MM-DD-<what>.ts --sensor=<docId>            # dry run (default)
 *   npx tsx src/oneoff/YYYY-MM-DD-<what>.ts --sensor=<docId> --apply    # write (asks "yes")
 *
 * Undo: <how to revert — e.g. fields are backed up to `x-old`, or restore from out/*.csv>
 */
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run, str } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const sensorId = str(args.sensor);
  if (!sensorId) throw new Error("--sensor=<docId> required");

  // 1. READ + compute planned changes (no writes here)
  const snap = await db.collection(`work-sensors/${sensorId}/data-log`).limit(5).get();
  const plan = snap.docs
    .filter((d) => !d.id.startsWith("daily::"))
    .map((d) => ({ ref: d.ref, before: d.data(), after: { /* field: newValue */ } }));

  // 2. SHOW the plan
  console.log(`Planned changes: ${plan.length}`);
  plan.slice(0, 5).forEach((p) => console.log(`  ${p.ref.path}\n    before=${JSON.stringify(p.before)}\n    after =${JSON.stringify(p.after)}`));

  // 3. GUARD
  if (!plan.length || !(await confirmApply(args, `update ${plan.length} docs under work-sensors/${sensorId}/data-log`))) return;

  // 4. WRITE in batches, keeping the old value for undo
  const w = new BatchWriter();
  for (const p of plan) await w.update(p.ref, p.after);
  await w.flush();
  console.log(`✅ done: ${w.committed} docs updated`);
});
