/**
 * Read-only: how late do samples arrive, and what would the Phase 0 guards (FN-0.2) skip?
 * For each data-log doc: lag = Firestore createTime − sample.time. Replays the docs in createTime
 * order to count samples the out-of-order guard (time < max time seen so far) would skip, and the
 * >48h cutoff. "beyondWarn" = skipped samples whose |raw − initial-value| exceeds warn.gap on any axis
 * (i.e. potentially lost alerts).
 * Scope: active projects, sensors with warn/alarm gaps, excluding vibration-din and daily docs.
 * Usage: npx tsx src/analysis/ingest-lag.ts [--days=30] [--project=<id|name>] [--top=15]
 *        npx tsx src/analysis/ingest-lag.ts --sensor=<docId> [--days=30]   (per-day write batches)
 */
import { db } from "../lib/firebase";
import { num, parseArgs, run, str } from "../lib/cli";
import { projectName, sensorLabel } from "../lib/sensors";

const H = 3600e3;
const CUTOFF = 48 * H;

type Row = { key: string; n: number; lagOver1h: number; lagOver48h: number; outOfOrder: number; beyondWarn: number; maxLagH: number; secondsTime: number };
const row = (key: string): Row => ({ key, n: 0, lagOver1h: 0, lagOver48h: 0, outOfOrder: 0, beyondWarn: 0, maxLagH: 0, secondsTime: 0 });

run(async () => {
  const args = parseArgs();
  const days = num(args.days, 30);
  const top = num(args.top, 15);
  const from = Date.now() - days * 864e5;

  const one = str(args.sensor);
  if (one) {
    const snap = await db.collection(`work-sensors/${one}/data-log`).where("time", ">=", from).get();
    const hours = new Map<string, { n: number; minT: number; maxT: number; keys: Set<string> }>();
    snap.docs.filter((d) => !d.id.startsWith("daily::")).forEach((d) => {
      const x = d.data();
      const k = new Date(d.createTime.toMillis()).toISOString().slice(0, 13);
      const h = hours.get(k) ?? { n: 0, minT: Infinity, maxT: -Infinity, keys: new Set<string>() };
      h.n++;
      h.minT = Math.min(h.minT, x.time);
      h.maxT = Math.max(h.maxT, x.time);
      Object.keys(x).forEach((f) => h.keys.add(f));
      hours.set(k, h);
    });
    console.log(`${one}: docs grouped by createTime hour (UTC)`);
    [...hours].sort().forEach(([k, h]) =>
      console.log(`  ${k}h  ${String(h.n).padStart(5)} docs  sample time ${new Date(h.minT).toISOString().slice(0, 16)} → ${new Date(h.maxT).toISOString().slice(0, 16)}  fields: ${[...h.keys].sort().join(",")}`));
    return;
  }

  let projects = (await db.collection("projects").where("isActive", "==", true).get()).docs.map((d) => ({ id: d.id, name: projectName(d.data()) }));
  const pf = str(args.project);
  if (pf) projects = projects.filter((p) => p.id === pf || p.name.includes(pf));

  const byType = new Map<string, Row>();
  const bySource = new Map<string, Row>();
  const bySensor: (Row & { project: string })[] = [];
  const add = (m: Map<string, Row>, k: string, f: (r: Row) => void) => {
    if (!m.has(k)) m.set(k, row(k));
    f(m.get(k)!);
  };

  for (const p of projects) {
    const sensors = (await db.collection("work-sensors").where("location.site", "==", p.id).get()).docs.filter((d) => {
      const s = d.data();
      const axes = s.thresholds?.axes ?? {};
      return s.active !== false && s.type !== "vibration-din" && Object.values(axes).some((a: any) => a?.warn?.gap || a?.alarm?.gap);
    });
    for (const sd of sensors) {
      const s = sd.data();
      const axes: Record<string, any> = s.thresholds.axes;
      const init: Record<string, number> = s["initial-value"] ?? {};
      const snap = await db.collection(`work-sensors/${sd.id}/data-log`).where("time", ">=", from).get();
      const docs = snap.docs
        .filter((d) => !d.id.startsWith("daily::"))
        .map((d) => ({ d, x: d.data(), c: d.createTime.toMillis() }))
        .filter(({ x }) => typeof x.time === "number" && x.isReplay !== true && x.source !== "replay" && x.source !== "derived:daily")
        .sort((a, b) => a.c - b.c);

      const sr = { ...row(sd.id), project: p.name, key: `${sensorLabel(s, sd.id)} (${sd.id})` };
      let maxT = -Infinity;
      for (const { x, c } of docs) {
        const lag = c - x.time;
        const late = lag > CUTOFF;
        const ooo = x.time < maxT;
        maxT = Math.max(maxT, x.time);
        const beyond = (late || ooo) && Object.entries(axes).some(([ax, t]) => {
          const v = parseFloat(x[ax]);
          return t?.warn?.gap && !isNaN(v) && Math.abs(v - (init[ax] || 0)) > t.warn.gap;
        });
        const f = (r: Row) => {
          r.n++;
          if (lag > H) r.lagOver1h++;
          if (late) r.lagOver48h++;
          if (ooo) r.outOfOrder++;
          if (beyond) r.beyondWarn++;
          if (x.time < 1e12) r.secondsTime++;
          r.maxLagH = Math.max(r.maxLagH, lag / H);
        };
        f(sr);
        add(byType, s.type || "(none)", f);
        add(bySource, x.source ?? "-", f);
      }
      if (sr.n) bySensor.push(sr);
    }
  }

  const fmt = (r: Row) =>
    `${String(r.n).padStart(8)} ${String(r.lagOver1h).padStart(8)} ${String(r.lagOver48h).padStart(8)} ${String(r.outOfOrder).padStart(8)} ${String(r.beyondWarn).padStart(8)} ${r.maxLagH.toFixed(1).padStart(9)} ${String(r.secondsTime).padStart(6)}  ${r.key}`;
  const hdr = `${"samples".padStart(8)} ${">1h".padStart(8)} ${">48h".padStart(8)} ${"ooo".padStart(8)} ${"lostWarn".padStart(8)} ${"maxLagH".padStart(9)} ${"secs".padStart(6)}`;

  console.log(`\n${projects.length} active projects, ${bySensor.length} sensors with samples, last ${days}d (by sample time). Replay/daily excluded.`);
  console.log(`ooo = would be skipped by out-of-order guard; lostWarn = skipped (>48h or ooo) AND beyond warn; secs = time looks like seconds\n`);
  console.log("By sensor type:\n" + hdr);
  [...byType.values()].sort((a, b) => b.n - a.n).forEach((r) => console.log(fmt(r)));
  console.log("\nBy source:\n" + hdr);
  [...bySource.values()].sort((a, b) => b.n - a.n).forEach((r) => console.log(fmt(r)));
  console.log(`\nTop ${top} sensors by skipped (>48h + ooo):\n` + hdr);
  bySensor
    .filter((r) => r.lagOver48h + r.outOfOrder > 0)
    .sort((a, b) => b.lagOver48h + b.outOfOrder - (a.lagOver48h + a.outOfOrder))
    .slice(0, top)
    .forEach((r) => console.log(fmt(r) + `  @ ${r.project}`));
});
