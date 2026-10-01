/**
 * Read-only fleet backtest: today's alert rule vs the proposed two-tier rule, on real history.
 *
 * Scope: projects with isActive=true; sensors with active!==false and warn/alarm gaps on an axis
 * present in raw samples. Excludes vibration types (DIN 4150-3 has its own event logic) and
 * daily::* derived docs. Each sample is evaluated once in time order, so replay/rewrite storms
 * are NOT counted here — this compares the rules, not the storm bug.
 *
 * Proposed rule (see lib/signal.ts):
 *   Tier 2  24h trailing trimmed mean (20% each side) vs existing warn/alarm,
 *           persistence ≥3h & ≥2 evaluations, hysteresis 0.8, one alert per escalation
 *   Tier 1  raw jumps > alarm gap away from the previous 24h smoothed baseline, confirmed by 2 samples
 *
 * Usage: npx tsx src/analysis/backtest.ts [--days=60] [--project=<id|name>] [--type=tilt] [--concurrency=8]
 * Output: console summary + ops/out/backtest-<date>.json (per sensor-axis rows)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../lib/firebase";
import { list, num, parseArgs, run, str } from "../lib/cli";
import { projectName, sensorLabel } from "../lib/sensors";
import { anatomy, DAY, Pt, simulateCurrent, simulateTier1, simulateTier1Unconfirmed, simulateTier2, trailing, trimmedMean } from "../lib/signal";

const SKIP_TYPES = new Set(["vibration-din", "vibration", "vibration_vf"]);

type Row = {
  project: string; projectId: string; sensorId: string; label: string; type: string; axis: string;
  samples: number; perDay: number; warn: number; alarm: number;
  diurnalPP: number; sigma: number; spikePct: number; drift: number; level: number;
  current: number; tier2: number; tier1: number; tier1Unconfirmed: number;
  pctNonOkCurrent: number; pctNonOkTier2: number; tier2Final: string;
  noiseFloor: number; stuck: boolean; belowFloor: boolean;
};

run(async () => {
  const args = parseArgs();
  const days = num(args.days, 60);
  const from = Date.now() - days * DAY;
  const conc = num(args.concurrency, 8);

  const projSnap = await db.collection("projects").where("isActive", "==", true).get();
  let projects = projSnap.docs.map((d) => ({ id: d.id, name: projectName(d.data()) }));
  if (args.project) projects = projects.filter((p) => p.id === args.project || p.name.includes(String(args.project)));
  const pmap = new Map(projects.map((p) => [p.id, p.name]));

  const sensors: { id: string; d: FirebaseFirestore.DocumentData }[] = [];
  for (const p of projects) {
    const s = await db.collection("work-sensors").where("location.site", "==", p.id).get();
    s.docs.forEach((d) => sensors.push({ id: d.id, d: d.data() }));
  }
  const types = list(args.type);
  const candidates = sensors.filter(({ d }) =>
    d.active !== false && !SKIP_TYPES.has(d.type) && (!types.length || types.includes(d.type)) &&
    Object.values(d.thresholds?.axes ?? {}).some((a: any) => Number.isFinite(a?.warn?.gap) && Number.isFinite(a?.alarm?.gap)));
  console.log(`\n${projects.length} active projects, ${sensors.length} sensors, ${candidates.length} candidates (active, thresholds, non-vibration). Window ${days}d.\n`);

  const rows: Row[] = [];
  let done = 0;
  const queue = [...candidates];
  async function worker() {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        rows.push(...(await analyzeSensor(s.id, s.d)));
      } catch (e: any) {
        console.error(`  ! ${s.id}: ${e.message}`);
      }
      if (++done % 25 === 0) console.log(`  … ${done}/${candidates.length}`);
    }
  }

  async function analyzeSensor(id: string, d: FirebaseFirestore.DocumentData): Promise<Row[]> {
    const snap = await db.collection(`work-sensors/${id}/data-log`).where("time", ">=", from).orderBy("time").get();
    const docs = snap.docs.filter((x) => !x.id.startsWith("daily::")).map((x) => x.data()).filter((x) => x.suspect !== true);
    const out: Row[] = [];
    for (const [axis, thr] of Object.entries<any>(d.thresholds?.axes ?? {})) {
      const warn = Number(thr?.warn?.gap);
      const alarm = Number(thr?.alarm?.gap);
      if (!Number.isFinite(warn) || !Number.isFinite(alarm) || axis.startsWith("daily")) continue;
      const init = Number(d["initial-value"]?.[axis] ?? 0) || 0;
      const pts: Pt[] = [];
      for (const x of docs) {
        const v = parseFloat(x[axis]);
        if (Number.isFinite(v) && typeof x.time === "number") pts.push({ t: x.time, v: v - init });
      }
      if (pts.length < 30) continue;
      const span = pts[pts.length - 1].t - pts[0].t;
      const perDay = (pts.length / span) * DAY;
      const minCount = Math.max(3, Math.round(perDay * 0.25));
      const smooth = trailing(pts, 24, (v) => trimmedMean(v, 0.2), minCount);
      const an = anatomy(pts);
      const cur = simulateCurrent(pts, warn, alarm);
      const t2 = simulateTier2(smooth, warn, alarm);
      const t1 = simulateTier1(pts, smooth, alarm);
      const t1u = simulateTier1Unconfirmed(pts, smooth, alarm);
      const noiseFloor = (Number.isFinite(an.diurnalPP) ? an.diurnalPP / 2 : 0) + 4 * an.sigma;
      out.push({
        project: pmap.get(d.location?.site) ?? "?", projectId: d.location?.site, sensorId: id, label: sensorLabel(d, id), type: d.type, axis,
        samples: pts.length, perDay, warn, alarm,
        diurnalPP: an.diurnalPP, sigma: an.sigma, spikePct: an.spikeRate * 100, drift: an.drift, level: an.level,
        current: cur.alerts, tier2: t2.alerts, tier1: t1.alerts, tier1Unconfirmed: t1u.alerts,
        pctNonOkCurrent: cur.pctNonOk, pctNonOkTier2: t2.pctNonOk, tier2Final: t2.finalStatus,
        noiseFloor, stuck: t2.pctNonOk > 90, belowFloor: noiseFloor > warn,
      });
    }
    return out;
  }

  await Promise.all(Array.from({ length: conc }, worker));

  // ---- summaries
  const f = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "—");
  const sum = (rs: Row[], k: keyof Row) => rs.reduce((s, r) => s + (r[k] as number), 0);
  const summarize = (title: string, keyFn: (r: Row) => string) => {
    const g = new Map<string, Row[]>();
    rows.forEach((r) => (g.get(keyFn(r)) ?? g.set(keyFn(r), []).get(keyFn(r))!).push(r));
    console.log(`\n━━ ${title} ━━`);
    console.log(`${"".padEnd(30)} ${"axes".padStart(5)} ${"today".padStart(6)} ${"tier2".padStart(6)} ${"tier1".padStart(6)} ${"t1-noconf".padStart(9)}  ${"stuck".padStart(5)} ${"thr<floor".padStart(9)}`);
    [...g].sort((a, b) => sum(b[1], "current") - sum(a[1], "current")).forEach(([k, rs]) =>
      console.log(`${k.slice(0, 30).padEnd(30)} ${String(rs.length).padStart(5)} ${f(sum(rs, "current")).padStart(6)} ${f(sum(rs, "tier2")).padStart(6)} ${f(sum(rs, "tier1")).padStart(6)} ${f(sum(rs, "tier1Unconfirmed")).padStart(9)}  ${String(rs.filter((r) => r.stuck).length).padStart(5)} ${String(rs.filter((r) => r.belowFloor).length).padStart(9)}`));
  };
  summarize("By sensor type", (r) => r.type);
  summarize("By project", (r) => r.project);

  const tot = (k: keyof Row) => sum(rows, k);
  console.log(`\nTOTAL ${rows.length} sensor-axes over ${days}d: today=${tot("current")}  tier2=${tot("tier2")}  tier1=${tot("tier1")} (unconfirmed would be ${tot("tier1Unconfirmed")})`);
  console.log(`  stuck (smoothed beyond warn >90% of the time → baseline/threshold issue, not noise): ${rows.filter((r) => r.stuck).length}`);
  console.log(`  warn gap below the sensor's noise floor (diurnal/2 + 4σ): ${rows.filter((r) => r.belowFloor).length}`);

  console.log(`\nTop 15 by today's alerts:`);
  [...rows].sort((a, b) => b.current - a.current).slice(0, 15).forEach((r) =>
    console.log(`  ${String(r.current).padStart(4)} → t2 ${String(r.tier2).padStart(2)} t1 ${String(r.tier1).padStart(2)}  ${r.type.padEnd(12)} ${String(r.label).slice(0, 16).padEnd(16)} ${r.axis.padEnd(20)} warn ±${r.warn} | level ${f(r.level, 3)} diurnal ${f(r.diurnalPP, 3)} σ ${f(r.sigma, 3)} spikes ${f(r.spikePct, 1)}%${r.stuck ? " STUCK" : ""}  ${r.project}`));

  const outFile = path.resolve(__dirname, `../../out/backtest-${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ days, generatedAt: new Date().toISOString(), rows }, null, 2));
  console.log(`\n📄 ${outFile}\n`);
});
