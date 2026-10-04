/**
 * Read-only: ATS station frame check. Groups a station's live samples (via ats-device-map prefix) into
 * cycles and, with --a/--b, fits a 3D affine transform between two cycles. A wrong resection / station
 * frame shows as a rigid rotation+translation with ~1 mm residuals across all points of the cycle.
 *
 * Usage: npx tsx src/analysis/ats-frame.ts --prefix=ATS-6- --from=ISO --to=ISO [--a=<cycle#> --b=<cycle#>]
 */
import { db } from "../lib/firebase";
import { parseArgs, run, str } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const prefix = str(args.prefix) ?? "ATS-6-";
  const from = Date.parse(str(args.from)!), to = Date.parse(str(args.to)!);
  const map = (await db.collection("ats-device-map").get()).docs.filter((d) => d.id.startsWith(prefix));
  type S = { dev: string; sensor: string; t: number; e: number; n: number; u: number; de: number; dn: number; du: number; created: string };
  const all: S[] = [];
  for (const m of map) {
    const sid = m.data().sensorId;
    const snap = await db.collection(`work-sensors/${sid}/data-log`).where("time", ">=", from).where("time", "<=", to).get();
    snap.docs.forEach((d) => { const x = d.data(); if (x.source === "ats_live") all.push({ dev: m.id, sensor: sid, t: x.time, e: x.e, n: x.n, u: x.u, de: x.EastingDisplacement, dn: x.NorthingDisplacement, du: x.HeightDisplacement, created: d.createTime.toDate().toISOString() }); });
  }
  // cycles = clusters of samples within 45 min
  all.sort((a, b) => a.t - b.t);
  const cycles: S[][] = [];
  all.forEach((s) => { const c = cycles[cycles.length - 1]; if (c && s.t - c[c.length - 1].t < 45 * 60e3) c.push(s); else cycles.push([s]); });
  console.log(`${map.length} devices, ${all.length} samples, ${cycles.length} cycles`);
  cycles.forEach((c, i) => {
    const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
    console.log(`  #${i} ${new Date(c[0].t).toISOString()}..${new Date(c[c.length - 1].t).toISOString().slice(11, 19)} pts=${c.length} uniqDev=${new Set(c.map((s) => s.dev)).size} median dE=${med(c.map((s) => s.de)).toFixed(1)} dN=${med(c.map((s) => s.dn)).toFixed(1)} dH=${med(c.map((s) => s.du)).toFixed(1)} written=${c[0].created.slice(0, 19)}`);
  });
  const ia = Number(args.a), ib = Number(args.b);
  if (!Number.isFinite(ia) || !Number.isFinite(ib)) return;
  const A = new Map(cycles[ia].map((s) => [s.dev, s])), B = new Map(cycles[ib].map((s) => [s.dev, s]));
  const pairs = [...A.keys()].filter((k) => B.has(k)).map((k) => [A.get(k)!, B.get(k)!] as const);
  // Helmert 2D: B = R(theta)*A + t (least squares)
  const ma = { e: 0, n: 0 }, mb = { e: 0, n: 0 };
  pairs.forEach(([a, b]) => { ma.e += a.e; ma.n += a.n; mb.e += b.e; mb.n += b.n; });
  ma.e /= pairs.length; ma.n /= pairs.length; mb.e /= pairs.length; mb.n /= pairs.length;
  let sxx = 0, sxy = 0;
  pairs.forEach(([a, b]) => { const ax = a.e - ma.e, ay = a.n - ma.n, bx = b.e - mb.e, by = b.n - mb.n; sxx += ax * bx + ay * by; sxy += ax * by - ay * bx; });
  const th = Math.atan2(sxy, sxx);
  console.log(`\nHelmert #${ia}->#${ib}: ${pairs.length} common points, rotation=${(th * 180 / Math.PI).toFixed(4)}° (${(th * 636.62).toFixed(2)} mgon)`);
  // 3D affine fit B = M*A + t (per output coord, 4 unknowns, normal equations)
  const solve4 = (rows: number[][], y: number[]) => {
    const N = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
    const v = [0, 1, 2, 3].map((i) => rows.reduce((s, r, k) => s + r[i] * y[k], 0));
    for (let i = 0; i < 4; i++) { for (let k = i + 1; k < 4; k++) { const f = N[k][i] / N[i][i]; for (let j = i; j < 4; j++) N[k][j] -= f * N[i][j]; v[k] -= f * v[i]; } }
    const x = [0, 0, 0, 0]; for (let i = 3; i >= 0; i--) { x[i] = (v[i] - [0, 1, 2, 3].slice(i + 1).reduce((s, j) => s + N[i][j] * x[j], 0)) / N[i][i]; } return x;
  };
  const uniq = pairs.filter(([a], i) => pairs.findIndex(([c]) => c.sensor === a.sensor) === i);
  const rows = uniq.map(([a]) => [a.e, a.n, a.u, 1]);
  const co = (["e", "n", "u"] as const).map((k) => solve4(rows, uniq.map(([, b]) => b[k])));
  console.log(`3D affine fit (${uniq.length} pts): M=${co.map((c) => c.slice(0, 3).map((x) => x.toFixed(5)).join(" ")).join(" | ")}  t=${co.map((c) => (c[3] * 1000).toFixed(0)).join("/")} mm`);
  const res = uniq.map(([a, b]) => ({ dev: a.dev, r: Math.hypot(...(["e", "n", "u"] as const).map((k, i) => (co[i][0] * a.e + co[i][1] * a.n + co[i][2] * a.u + co[i][3] - b[k]) * 1000)) }));
  res.sort((x, y) => y.r - x.r);
  console.log(`  affine residuals mm: max ${res.slice(0, 5).map((x) => `${x.dev}=${x.r.toFixed(1)}`).join(", ")}; median ${res[res.length >> 1].r.toFixed(1)}`);
  pairs.forEach(([a, b]) => {
    const ax = a.e - ma.e, ay = a.n - ma.n;
    const pe = Math.cos(th) * ax - Math.sin(th) * ay + mb.e, pn = Math.sin(th) * ax + Math.cos(th) * ay + mb.n;
    console.log(`  ${a.dev.padEnd(14)} ${a.sensor.padEnd(30)} A e/n/u=${a.e.toFixed(3)}/${a.n.toFixed(3)}/${a.u.toFixed(3)}  Δe=${((b.e - a.e) * 1000).toFixed(1)} Δn=${((b.n - a.n) * 1000).toFixed(1)} Δu=${((b.u - a.u) * 1000).toFixed(1)} mm  resid=${(Math.hypot(b.e - pe, b.n - pn) * 1000).toFixed(1)} mm`);
  });
});
