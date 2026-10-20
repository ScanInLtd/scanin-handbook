/**
 * Read-only: per sensor, the change of an axis between the start and the end of its data
 * (median of the first / last N days), plus data span, last real vs last replayed sample.
 * Usage: npx tsx src/analysis/settlement-span.ts <projectId|name> [--axis=HeightDisplacement] [--type=prism] [--edge-days=14] [--until=YYYY-MM-DD]
 */
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, parseWhen, run, str } from "../lib/cli";
import { projectSensors, resolveProject } from "../lib/sensors";
import { DAY, median } from "../lib/signal";

run(async () => {
  const args = parseArgs();
  const project = await resolveProject(args._[0] ?? "");
  const axis = str(args.axis) ?? "HeightDisplacement";
  const edge = num(args["edge-days"], 14) * DAY;
  const until = parseWhen(str(args.until), Date.now());
  const sensors = (await projectSensors(project.id, str(args.type) ?? "prism")).filter((s) => s.data.active !== false);
  console.log(`\n● ${project.name}: ${sensors.length} sensors, axis ${axis}, edges = ${edge / DAY}d, until ${new Date(until).toISOString().slice(0, 10)}\n`);
  console.log(`${"sensor".padEnd(10)} ${"first".padEnd(12)} ${"last real".padEnd(26)} ${"last replay".padEnd(26)} ${"start".padStart(7)} ${"end".padStart(7)} ${"Δ smooth".padStart(9)} ${"Δ raw".padStart(7)}`);
  const deltas: number[] = [];
  for (const s of sensors) {
    const init = Number(s.data["initial-value"]?.[axis] ?? 0) || 0;
    const snap = await db.collection(`work-sensors/${s.id}/data-log`).where("time", "<=", until).orderBy("time").get();
    const docs = snap.docs.filter((d) => !d.id.startsWith("daily::")).map((d) => d.data()).filter((x) => Number.isFinite(parseFloat(x[axis])));
    if (!docs.length) { console.log(`${String(s.label).padEnd(10)} (no data)`); continue; }
    const t0 = docs[0].time, t1 = docs[docs.length - 1].time;
    const pick = (from: number, to: number, f: (x: any) => number) => median(docs.filter((x) => x.time >= from && x.time <= to).map(f).filter(Number.isFinite));
    const sm = (x: any) => x.smooth?.[axis] ?? NaN;
    const rw = (x: any) => parseFloat(x[axis]) - init;
    const dS = pick(t1 - edge, t1, sm) - pick(t0, t0 + edge, sm);
    const dR = pick(t1 - edge, t1, rw) - pick(t0, t0 + edge, rw);
    if (Number.isFinite(dS)) deltas.push(dS);
    const real = [...docs].reverse().find((x) => !x.isReplay && x.source !== "replay");
    const rep = [...docs].reverse().find((x) => x.isReplay || x.source === "replay");
    console.log(`${String(s.label).padEnd(10)} ${new Date(t0).toISOString().slice(0, 10).padEnd(12)} ${fmtTime(real?.time ?? null).padEnd(26)} ${fmtTime(rep?.time ?? null).padEnd(26)} ${pick(t0, t0 + edge, sm).toFixed(2).padStart(7)} ${pick(t1 - edge, t1, sm).toFixed(2).padStart(7)} ${dS.toFixed(2).padStart(9)} ${dR.toFixed(2).padStart(7)}`);
  }
  console.log(`\nmedian Δ smooth across sensors: ${median(deltas).toFixed(2)} mm (n=${deltas.length})`);
});
