/**
 * Backfill `smooth` on existing manual (hand-entered) data-log samples.
 *
 * Manual samples can never satisfy computeSmooth's min-n/diurnal-coverage
 * gates (one reading every few weeks), so they never got `smooth` — the
 * reason the UI "ממוצע" line and report charts were empty for שקיעה שטראוס 4
 * and every other manual sensor. Deployed fix (checkThresholds +
 * recomputeSmoothing, 2026-11-02) passes manual samples straight through;
 * this script writes the same shape on historical docs:
 *   smooth = {n:1, replayN:0, q:1, w:24, v:1, manual:true, <axis>: raw-initial}
 * Only manual:true, non-suspect docs are touched. Initial is the piecewise
 * baseline in force at each sample's time (fallback: initial-value mirror).
 *
 * Usage:
 *   npx tsx src/oneoff/2026-11-02-manual-samples-smooth-backfill.ts [--sensor=<docId>]  # dry run
 *   npx tsx src/oneoff/2026-11-02-manual-samples-smooth-backfill.ts --apply             # all sensors
 *   npx tsx src/oneoff/2026-11-02-manual-samples-smooth-backfill.ts --sensor=MDmGzrpJPp0qticElM0B --apply
 *
 * Undo: values are recomputable — rerun `recomputeSmoothing` (which now has
 * the same pass-through) for any sensor/range.
 */
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run, str } from "../lib/cli";

const SKIP_FIELDS = new Set(["time", "manual", "suspect", "suspect_reason", "suspect_axis",
  "smooth", "eval", "source", "isReplay", "runId", "metadata", "id", "type"]);

const fmt = (n: number) => Math.round(n * 1e6) / 1e6;

run(async () => {
  const args = parseArgs();
  const sensorFilter = str(args.sensor);

  // sensor list
  let sensorDocs;
  if (sensorFilter) {
    const d = await db.doc(`work-sensors/${sensorFilter}`).get();
    if (!d.exists) throw new Error(`sensor ${sensorFilter} not found`);
    sensorDocs = [d];
  } else {
    const snap = await db.collection("work-sensors").get();
    sensorDocs = snap.docs;
  }

  type Plan = { ref: FirebaseFirestore.DocumentReference; path: string; smooth: Record<string, any>; label: string };
  const plan: Plan[] = [];
  const seen = new Map<string, number>();

  for (const sDoc of sensorDocs) {
    const s = sDoc.data()!;
    const evalAxes = Object.keys(s.thresholds?.axes || {});
    if (!evalAxes.length) continue;

    // piecewise baseline (same rule as checkThresholds): latest event ≤ t, else initial-value
    const evSnap = await sDoc.ref.collection("baseline-events").orderBy("time").get().catch(() => null);
    const events = (evSnap?.docs || []).map((d) => d.data()).filter((e) => typeof e?.time === "number" && e?.initial);
    const initialMirror = s["initial-value"] || {};
    const initialAt = (t: number) => {
      let found: any = null;
      for (const e of events) { if (e.time <= t) found = e; else break; }
      return found ? found.initial : initialMirror;
    };

    const logs = await sDoc.ref.collection("data-log").where("manual", "==", true).get().catch(() => null);
    if (!logs || logs.empty) continue;

    for (const doc of logs.docs) {
      const d = doc.data();
      if (d.suspect === true || typeof d.time !== "number") continue;
      const init = initialAt(d.time);
      const smooth: Record<string, any> = { n: 1, replayN: 0, q: 1, w: 24, v: 1, manual: true };
      let any = false;
      for (const axis of evalAxes) {
        const raw = parseFloat(d[axis]);
        if (!Number.isFinite(raw)) continue;
        smooth[axis] = fmt(raw - (init[axis] || 0));
        any = true;
      }
      if (!any) continue;
      if (d.smooth && d.smooth.manual === true) continue; // already backfilled
      plan.push({ ref: doc.ref, path: doc.ref.path, smooth, label: `${s.name || sDoc.id}/${d.time}` });
    }
    seen.set(sDoc.id, (seen.get(sDoc.id) || 0) + logs.size);
  }

  console.log(`Planned backfills: ${plan.length} docs across ${new Set(plan.map(p => p.ref.path.split("/")[1])).size} sensors`);
  plan.slice(0, 15).forEach((p) => console.log(`  ${p.label}\n    smooth=${JSON.stringify(p.smooth)}`));
  if (plan.length > 15) console.log(`  … (+${plan.length - 15} more)`);

  if (!plan.length || !(await confirmApply(args, `write smooth on ${plan.length} manual data-log docs`))) return;

  const w = new BatchWriter();
  for (const p of plan) await w.update(p.ref, { smooth: p.smooth });
  await w.flush();
  console.log(`done: ${w.committed} docs updated`);
});
