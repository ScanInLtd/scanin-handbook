/**
 * Read-only: monthly median of raw axis values (minus the current initial-value) for one sensor,
 * plus its baseline events and sources — shows baseline eras / steps in history.
 * Usage: npx tsx src/analysis/level-by-month.ts <sensorId> [--axes=EastingDisplacement,NorthingDisplacement,HeightDisplacement]
 */
import { db } from "../lib/firebase";
import { list, parseArgs, run } from "../lib/cli";
import { median } from "../lib/signal";

run(async () => {
  const args = parseArgs();
  const id = args._[0];
  const axes = list(args.axes).length ? list(args.axes) : ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"];
  const s = (await db.collection("work-sensors").doc(id).get()).data();
  if (!s) throw new Error(`sensor ${id} not found`);
  const init = s["initial-value"] ?? {};
  console.log(`\n● ${s.name} (${id}) type=${s.type}  initial-value=${JSON.stringify(Object.fromEntries(axes.map((a) => [a, init[a]])))}`);
  const ev = await db.collection(`work-sensors/${id}/baseline-events`).orderBy("time").get();
  ev.docs.forEach((d) => {
    const e = d.data();
    console.log(`  baseline ${new Date(e.time).toISOString().slice(0, 16)} ${e.reason} ${JSON.stringify(Object.fromEntries(axes.map((a) => [a, e.initial?.[a]])))}`);
  });
  const snap = await db.collection(`work-sensors/${id}/data-log`).get();
  const m = new Map<string, { vals: Record<string, number[]>; n: number; susp: number; src: Map<string, number> }>();
  snap.docs.forEach((d) => {
    if (d.id.startsWith("daily::")) return;
    const x = d.data();
    if (typeof x.time !== "number") return;
    const k = new Date(x.time).toISOString().slice(0, 7);
    const e = m.get(k) ?? { vals: {}, n: 0, susp: 0, src: new Map() };
    e.n++;
    if (x.suspect) e.susp++;
    e.src.set(String(x.source ?? "-"), (e.src.get(String(x.source ?? "-")) ?? 0) + 1);
    axes.forEach((a) => {
      const v = parseFloat(x[a]);
      if (Number.isFinite(v)) (e.vals[a] ??= []).push(v - (Number(init[a]) || 0));
    });
    m.set(k, e);
  });
  console.log(`\n  month    n    susp  ${axes.map((a) => a.replace("Displacement", "").padStart(10)).join("")}  sources`);
  [...m].sort().forEach(([k, e]) =>
    console.log(`  ${k} ${String(e.n).padStart(5)} ${String(e.susp).padStart(5)}  ${axes.map((a) => (e.vals[a] ? median(e.vals[a]).toFixed(1) : "—").padStart(10)).join("")}  ${[...e.src].map(([s2, n]) => `${s2}:${n}`).join(" ")}`));
});
