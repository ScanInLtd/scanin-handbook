/**
 * Mark DeVinci ironing events as continuity events (`continuity: true`) so the MA window spans them
 * (functions task inbox/20261023-1240-ma-continuity-events.md). Only events with note "flatten: step …"
 * (the "start of data" zero stays a normal reset). Idempotent.
 * Usage: npx tsx src/oneoff/2026-10-23-devinci-continuity-flag.ts [--apply]
 */
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run } from "../lib/cli";
import { projectSensors } from "../lib/sensors";

const PROJECT = "hmPh7Hg2fjTc9GyNRDYO";

run(async () => {
  const args = parseArgs();
  const sensors = (await projectSensors(PROJECT, "prism")).filter((s) => s.data.active !== false);
  const refs: FirebaseFirestore.DocumentReference[] = [];
  let already = 0, starts = 0;
  for (const s of sensors) {
    const snap = await db.collection(`work-sensors/${s.id}/baseline-events`).get();
    for (const d of snap.docs) {
      const note = String(d.data().note ?? "");
      if (note.startsWith("flatten: start")) { starts++; continue; }
      if (!note.startsWith("flatten: step")) continue;
      if (d.data().continuity === true) { already++; continue; }
      refs.push(d.ref);
    }
  }
  console.log(`${sensors.length} prisms · start-of-data events ${starts} (unchanged) · step events to mark ${refs.length} · already marked ${already}`);
  if (!refs.length || !(await confirmApply(args, `set continuity:true on ${refs.length} DeVinci ironing events`))) return;
  const w = new BatchWriter();
  for (const r of refs) await w.update(r, { continuity: true });
  await w.flush();
  console.log(`✅ ${w.committed} events marked`);
});
