/**
 * Read-only: verify ats-device-map (live ATS-6 device -> legacy Hexagon sensor) by geometry. Live e/n/u
 * (good window) are fitted to Hexagon Easting/Northing/Height (pre-cutover window); each device is then
 * matched to the nearest Hexagon sensor. MISMATCH = device writes into a sensor of another physical prism.
 *
 * Usage: npx tsx src/analysis/ats-crossmap.ts [--liveFrom= --liveTo= --hexFrom= --hexTo=]
 */
import { db } from "../lib/firebase";
import { parseArgs, run, str } from "../lib/cli";
import { median } from "../lib/signal";

run(async () => {
  const args = parseArgs();
  const lf = Date.parse(str(args.liveFrom) ?? "2026-09-06T00:00:00Z"), lt = Date.parse(str(args.liveTo) ?? "2026-09-07T00:00:00Z");
  const hf = Date.parse(str(args.hexFrom) ?? "2026-08-01T00:00:00Z"), ht = Date.parse(str(args.hexTo) ?? "2026-08-21T00:00:00Z");
  const map = (await db.collection("ats-device-map").get()).docs.filter((d) => d.id.startsWith("ATS-6-"));
  const hexSensors = (await db.collection("work-sensors").where("type", "==", "prism").get()).docs.filter((d) => String(d.data().MAC ?? "").startsWith("PRISM%ATS1%H"));
  const hex = new Map<string, { mac: string; name: string; site: string; p: number[] }>();
  await Promise.all(hexSensors.map(async (s) => {
    const xs = (await db.collection(`work-sensors/${s.id}/data-log`).where("time", ">=", hf).where("time", "<=", ht).get()).docs.map((d) => d.data()).filter((x) => Number.isFinite(x.Easting));
    if (xs.length) hex.set(s.id, { mac: s.data().MAC, name: s.data().name, site: s.data().location?.site, p: [median(xs.map((x) => x.Easting)), median(xs.map((x) => x.Northing)), median(xs.map((x) => x.Height))].map((v) => v / 1000) });
  }));
  const live: { dev: string; sensor: string; p: number[] }[] = [];
  for (const m of map) {
    const xs = (await db.collection(`work-sensors/${m.data().sensorId}/data-log`).where("time", ">=", lf).where("time", "<=", lt).get()).docs.map((d) => d.data()).filter((x) => x.source === "ats_live" && Number.isFinite(x.e));
    if (xs.length) live.push({ dev: m.id, sensor: m.data().sensorId, p: [median(xs.map((x) => x.e)), median(xs.map((x) => x.n)), median(xs.map((x) => x.u))] });
  }
  const solve4 = (rows: number[][], y: number[]) => {
    const N = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
    const v = [0, 1, 2, 3].map((i) => rows.reduce((s, r, k) => s + r[i] * y[k], 0));
    for (let i = 0; i < 4; i++) for (let k = i + 1; k < 4; k++) { const f = N[k][i] / N[i][i]; for (let j = i; j < 4; j++) N[k][j] -= f * N[i][j]; v[k] -= f * v[i]; }
    const x = [0, 0, 0, 0]; for (let i = 3; i >= 0; i--) x[i] = (v[i] - [1, 2, 3].filter((j) => j > i).reduce((s, j) => s + N[i][j] * x[j], 0)) / N[i][i]; return x;
  };
  let pairs = live.filter((l) => hex.has(l.sensor)).map((l) => ({ ...l, h: hex.get(l.sensor)!.p }));
  pairs = pairs.filter((p, i) => pairs.findIndex((q) => q.sensor === p.sensor) === i);
  let co: number[][] = [];
  const fit = (ps: typeof pairs) => { const rows = ps.map((p) => [...p.p, 1]); co = [0, 1, 2].map((k) => solve4(rows, ps.map((p) => p.h[k]))); };
  const tf = (p: number[]) => co.map((c) => c[0] * p[0] + c[1] * p[1] + c[2] * p[2] + c[3]);
  const res = (p: (typeof pairs)[0]) => Math.hypot(...tf(p.p).map((v, k) => v - p.h[k]));
  let inl = pairs;
  for (let it = 0; it < 15; it++) { fit(inl); const r = inl.map(res); const worst = Math.max(...r); if (worst < 0.05) break; inl = inl.filter((p, i) => r[i] !== worst); }
  console.log(`pairs=${pairs.length} inliers=${inl.length}; scale/rot rows: ${co.map((c) => c.slice(0, 3).map((x) => x.toFixed(4)).join(" ")).join(" | ")}`);
  for (const l of live.sort((a, b) => a.dev.localeCompare(b.dev))) {
    const q = tf(l.p);
    const near = [...hex].map(([id, h]) => ({ id, ...h, d: Math.hypot(...q.map((v, k) => v - h.p[k])) })).sort((a, b) => a.d - b.d);
    const mapped = hex.get(l.sensor);
    const dMapped = mapped ? Math.hypot(...q.map((v, k) => v - mapped.p[k])) : NaN;
    const flag = near[0].id === l.sensor && near[0].d < 0.1 ? "OK " : "MISMATCH";
    console.log(`  ${flag} ${l.dev.padEnd(14)} -> mapped ${String(mapped?.mac ?? l.sensor).padEnd(20)} d=${(dMapped * 1000).toFixed(0).padStart(6)}mm | nearest ${near[0].mac} (${near[0].id}, name=${near[0].name}) d=${(near[0].d * 1000).toFixed(0)}mm, 2nd ${near[1].mac} d=${(near[1].d * 1000).toFixed(0)}mm`);
  }
});
