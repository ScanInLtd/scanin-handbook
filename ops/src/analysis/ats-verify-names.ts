/**
 * Read-only: verify a proposed physical naming (f<floor>p<column>) for ATS points against
 * their measured site coordinates.
 *   - same column  → points should share east/north (a vertical line on the facade)
 *   - floor order  → height u should increase with floor, ~one storey per step
 *   - two points with the same coordinates are the same prism
 *
 * Point coordinates = median e/n/u of the point's recent samples (via ats-device-map).
 * Points that write into a shared sensor are split by alternating sample order.
 *
 * Usage: npx tsx src/analysis/ats-verify-names.ts --map=<file with "A1-f4p1" lines> [--station=5] [--days=60]
 */
import * as fs from "node:fs";
import { db } from "../lib/firebase";
import { num, parseArgs, run, str } from "../lib/cli";
import { DAY, median } from "../lib/signal";

type C = { e: number; n: number; u: number; n_: number };

run(async () => {
  const args = parseArgs();
  const station = str(args.station) ?? "5";
  const from = Date.now() - num(args.days, 60) * DAY;
  const lines = fs.readFileSync(String(args.map), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const proposed = lines.map((l) => {
    const [pt, name] = l.split("-");
    const m = name.match(/^f(\d+)p(\d+)$/i);
    return { pt: pt.toUpperCase(), name, floor: m ? +m[1] : NaN, col: m ? +m[2] : NaN };
  });

  const mapSnap = await db.collection("ats-device-map").get();
  const map = new Map(mapSnap.docs.map((d) => [d.id.toUpperCase(), d.data().sensorId as string]));
  const allPts = [...new Set([...proposed.map((p) => p.pt), ...[...map.keys()].filter((k) => k.startsWith(`ATS-${station}-`)).map((k) => k.slice(`ATS-${station}-`.length))])];

  // samples per sensor (cache) — split shared sensors between their devices by coordinate clustering on u
  const bySensor = new Map<string, any[]>();
  const coords = new Map<string, C | null>();
  for (const pt of allPts) {
    const sid = map.get(`ATS-${station}-${pt}`);
    if (!sid) { coords.set(pt, null); continue; }
    if (!bySensor.has(sid)) {
      const snap = await db.collection(`work-sensors/${sid}/data-log`).where("time", ">=", from).get();
      bySensor.set(sid, snap.docs.map((d) => d.data()).filter((x) => [x.e, x.n, x.u].every(Number.isFinite) && x.suspect !== true).sort((a, b) => a.time - b.time));
    }
  }
  const sharers = new Map<string, string[]>();
  allPts.forEach((pt) => { const sid = map.get(`ATS-${station}-${pt}`); if (sid) sharers.set(sid, [...(sharers.get(sid) ?? []), pt]); });
  for (const [sid, pts] of sharers) {
    const s = bySensor.get(sid) ?? [];
    const med = (xs: any[]): C | null => (xs.length ? { e: median(xs.map((x) => x.e)), n: median(xs.map((x) => x.n)), u: median(xs.map((x) => x.u)), n_: xs.length } : null);
    if (pts.length === 1) { coords.set(pts[0], med(s)); continue; }
    // two devices in one sensor: split by height (k-means k=2 on u), assign lower cluster to the point with the lower proposed floor
    const us = s.map((x) => x.u).sort((a, b) => a - b);
    let c1 = us[0], c2 = us[us.length - 1];
    for (let it = 0; it < 20; it++) {
      const g1 = s.filter((x) => Math.abs(x.u - c1) <= Math.abs(x.u - c2)), g2 = s.filter((x) => Math.abs(x.u - c1) > Math.abs(x.u - c2));
      c1 = median(g1.map((x) => x.u)); c2 = median(g2.map((x) => x.u));
    }
    const lo = s.filter((x) => Math.abs(x.u - c1) <= Math.abs(x.u - c2)), hi = s.filter((x) => Math.abs(x.u - c1) > Math.abs(x.u - c2));
    const ordered = [...pts].sort((a, b) => (proposed.find((p) => p.pt === a)?.floor ?? 0) - (proposed.find((p) => p.pt === b)?.floor ?? 0));
    coords.set(ordered[0], med(lo));
    coords.set(ordered[1], med(hi));
    console.log(`note: ${pts.join(" & ")} share sensor ${sid}; split by height → ${ordered[0]} u≈${c1.toFixed(2)}, ${ordered[1]} u≈${c2.toFixed(2)}`);
  }

  // storey height estimate: median of u-steps within columns
  const rows = proposed.map((p) => ({ ...p, c: coords.get(p.pt) ?? null }));
  const steps: number[] = [];
  const cols = [...new Set(rows.map((r) => r.col))].sort((a, b) => a - b);
  for (const col of cols) {
    const rs = rows.filter((r) => r.col === col && r.c).sort((a, b) => a.floor - b.floor);
    for (let i = 1; i < rs.length; i++) if (rs[i].floor !== rs[i - 1].floor) steps.push((rs[i].c!.u - rs[i - 1].c!.u) / (rs[i].floor - rs[i - 1].floor));
  }
  const storey = median(steps);
  // global floor reference: u ≈ u0 + storey·floor  → u0 = median(u − storey·floor)
  const u0 = median(rows.filter((r) => r.c).map((r) => r.c!.u - storey * r.floor));
  console.log(`\nstorey height ≈ ${storey.toFixed(2)} m (from ${steps.length} steps); floor estimate = (u − ${u0.toFixed(2)}) / ${storey.toFixed(2)}\n`);

  const issues: string[] = [];
  console.log(`${"col".padEnd(4)} ${"PC".padEnd(5)} ${"new".padEnd(8)} ${"e".padStart(9)} ${"n".padStart(9)} ${"u".padStart(8)}  est.floor  Δ col-line(m)  check`);
  for (const col of cols) {
    const rs = rows.filter((r) => r.col === col).sort((a, b) => a.floor - b.floor);
    const withC = rs.filter((r) => r.c);
    const ce = median(withC.map((r) => r.c!.e)), cn = median(withC.map((r) => r.c!.n));
    for (const r of rs) {
      if (!r.c) { console.log(`p${String(col).padEnd(3)} ${r.pt.padEnd(5)} ${r.name.padEnd(8)} ${"— no recent coordinates —".padStart(28)}`); issues.push(`${r.pt} (${r.name}): no coordinates to verify`); continue; }
      const est = (r.c.u - u0) / storey;
      const off = Math.hypot(r.c.e - ce, r.c.n - cn);
      const flags: string[] = [];
      if (Math.abs(est - r.floor) > 0.4) flags.push(`floor looks like f${Math.round(est)}`);
      if (off > 1.0) flags.push(`not on column line (${off.toFixed(1)} m off)`);
      console.log(`p${String(col).padEnd(3)} ${r.pt.padEnd(5)} ${r.name.padEnd(8)} ${r.c.e.toFixed(3).padStart(9)} ${r.c.n.toFixed(3).padStart(9)} ${r.c.u.toFixed(3).padStart(8)}  ${est.toFixed(2).padStart(8)}  ${off.toFixed(2).padStart(12)}  ${flags.length ? "⚠️ " + flags.join("; ") : "✅"}`);
      flags.forEach((f) => issues.push(`${r.pt} (${r.name}): ${f}`));
    }
  }
  // same-prism check
  const withC = rows.filter((r) => r.c);
  for (let i = 0; i < withC.length; i++) for (let j = i + 1; j < withC.length; j++) {
    const d = Math.hypot(withC[i].c!.e - withC[j].c!.e, withC[i].c!.n - withC[j].c!.n, withC[i].c!.u - withC[j].c!.u);
    if (d < 0.1) issues.push(`${withC[i].pt} (${withC[i].name}) and ${withC[j].pt} (${withC[j].name}) are the same prism (${(d * 100).toFixed(1)} cm apart)`);
  }
  // points not in the proposal
  const missing = allPts.filter((p) => !proposed.find((x) => x.pt === p));
  for (const p of missing) {
    const c = coords.get(p);
    if (!c) { issues.push(`${p}: not in the list, no coordinates`); continue; }
    const near = withC.map((r) => ({ r, d: Math.hypot(r.c!.e - c.e, r.c!.n - c.n, r.c!.u - c.u) })).sort((a, b) => a.d - b.d)[0];
    const colGuess = cols.map((col) => {
      const rs = withC.filter((r) => r.col === col);
      return { col, d: Math.hypot(median(rs.map((r) => r.c!.e)) - c.e, median(rs.map((r) => r.c!.n)) - c.n) };
    }).sort((a, b) => a.d - b.d)[0];
    issues.push(`${p}: NOT in the list. Coordinates suggest f${Math.round((c.u - u0) / storey)}p${colGuess.col} (column line ${colGuess.d.toFixed(2)} m)${near && near.d < 0.1 ? `; same prism as ${near.r.pt} (${near.r.name})` : ""}`);
  }
  console.log(`\n━━ Findings (${issues.length}) ━━`);
  issues.forEach((i) => console.log(`  • ${i}`));
});
