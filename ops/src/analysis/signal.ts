/**
 * Read-only signal anatomy + alert-strategy simulation for one sensor axis.
 *
 * Usage: npx tsx src/analysis/signal.ts <sensorDocId> --axis=y [--days=60] [--warn=] [--alarm=] [--csv]
 *
 * Decomposes the adjusted series (raw − initial-value) into:
 *   - drift      : range of 7-day medians over the window (the "real" movement)
 *   - diurnal    : peak-to-peak of the hour-of-day profile after removing a centred 24h median
 *   - noise      : robust σ (1.4826·MAD) of residual after removing trend + diurnal
 *   - spikes     : residual samples beyond 5σ
 * then replays the window through several evaluation strategies, using the SAME status/alert
 * rules as checkThresholds (symmetric ±gap, alert on worsening, 24h throttle per axis),
 * and reports alerts + % time in warn/alarm for each.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../lib/firebase";
import { num, parseArgs, run, str } from "../lib/cli";

type P = { t: number; v: number; temp?: number };
const H = 3.6e6;
const DAY = 24 * H;

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mad = (a: number[]) => {
  const m = median(a);
  return median(a.map((x) => Math.abs(x - m)));
};
const trimmedMean = (a: number[], pct: number) => {
  const s = [...a].sort((x, y) => x - y);
  const k = Math.floor(s.length * pct);
  const mid = k * 2 >= s.length ? [s[s.length >> 1]] : s.slice(k, s.length - k);
  return mid.reduce((x, y) => x + y, 0) / mid.length;
};
const fmt = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "—");

/** window values in [t-before, t+after] using two pointers would be faster; n is small enough */
const windowVals = (pts: P[], i: number, before: number, after: number) => {
  const t = pts[i].t;
  const out: number[] = [];
  for (let j = i; j >= 0 && pts[j].t >= t - before; j--) out.push(pts[j].v);
  for (let j = i + 1; j < pts.length && pts[j].t <= t + after; j++) out.push(pts[j].v);
  return out;
};

type Status = "ok" | "warn" | "alarm";
const SEV = { ok: 0, warn: 1, alarm: 2 } as const;

function simulate(series: { t: number; v: number }[], warn: number, alarm: number, persistence = 1) {
  let status: Status = "ok";
  let lastAlert = -Infinity;
  let alerts = 0;
  let flips = 0;
  let pending: Status | null = null;
  let pendingCount = 0;
  let timeNonOk = 0;
  for (let i = 0; i < series.length; i++) {
    const { t, v } = series[i];
    if (i > 0 && status !== "ok") timeNonOk += t - series[i - 1].t;
    if (!Number.isFinite(v)) continue;
    const a = Math.abs(v);
    let next: Status = a > alarm ? "alarm" : a > warn ? "warn" : "ok";
    if (persistence > 1 && next !== status) {
      if (pending === next) pendingCount++;
      else {
        pending = next;
        pendingCount = 1;
      }
      if (pendingCount < persistence) continue;
    }
    pending = null;
    pendingCount = 0;
    if (next !== status) {
      flips++;
      if (SEV[next] > SEV[status] && t - lastAlert >= DAY) {
        alerts++;
        lastAlert = t;
      }
      status = next;
    }
  }
  const span = series.length > 1 ? series[series.length - 1].t - series[0].t : 1;
  return { alerts, flips, pctNonOk: (timeNonOk / span) * 100 };
}

run(async () => {
  const args = parseArgs();
  const id = args._[0];
  const axis = str(args.axis);
  if (!id || !axis) throw new Error("usage: signal.ts <sensorDocId> --axis=<field> [--days=60]");
  const days = num(args.days, 60);

  const sensor = (await db.collection("work-sensors").doc(id).get()).data();
  if (!sensor) throw new Error(`sensor ${id} not found`);
  const initial = Number(sensor["initial-value"]?.[axis] ?? 0) || 0;
  const thr = sensor.thresholds?.axes?.[axis];
  const warn = num(args.warn, thr?.warn?.gap ?? NaN);
  const alarm = num(args.alarm, thr?.alarm?.gap ?? NaN);

  const from = Date.now() - days * DAY;
  const snap = await db.collection(`work-sensors/${id}/data-log`).where("time", ">=", from).orderBy("time").get();
  const pts: P[] = [];
  let suspect = 0;
  let replay = 0;
  for (const d of snap.docs) {
    if (d.id.startsWith("daily::")) continue;
    const x = d.data();
    if (x.suspect === true) suspect++;
    if (x.isReplay) replay++;
    const v = parseFloat(x[axis]);
    if (!Number.isFinite(v)) continue;
    const temp = parseFloat(x.temperature ?? x.temp ?? x.t);
    pts.push({ t: x.time, v: v - initial, temp: Number.isFinite(temp) ? temp : undefined });
  }
  if (pts.length < 20) throw new Error(`only ${pts.length} samples for ${axis} in ${days}d`);

  const intervals = pts.slice(1).map((p, i) => p.t - pts[i].t);
  const cadenceMin = median(intervals) / 6e4;
  const perDay = DAY / median(intervals);

  // ---- anatomy
  const c24 = pts.map((_, i) => median(windowVals(pts, i, 12 * H, 12 * H)));
  const detr = pts.map((p, i) => p.v - c24[i]);
  const hourBins: number[][] = Array.from({ length: 24 }, () => []);
  pts.forEach((p, i) => {
    const h = Number(new Date(p.t).toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" })) % 24;
    hourBins[h].push(detr[i]);
  });
  const profile = hourBins.map((b) => (b.length ? median(b) : NaN));
  const diurnalPP = Math.max(...profile.filter(Number.isFinite)) - Math.min(...profile.filter(Number.isFinite));
  const hourOf = (t: number) => Number(new Date(t).toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" })) % 24;
  const resid = pts.map((p, i) => detr[i] - (profile[hourOf(p.t)] || 0));
  const sigma = 1.4826 * mad(resid);
  const spikes = resid.filter((r) => Math.abs(r) > 5 * sigma).length;

  const dayGroups = new Map<string, number[]>();
  pts.forEach((p) => {
    const k = new Date(p.t).toLocaleDateString("sv-SE", { timeZone: "Asia/Jerusalem" });
    (dayGroups.get(k) ?? dayGroups.set(k, []).get(k)!).push(p.v);
  });
  const dailyRanges = [...dayGroups.values()].filter((v) => v.length >= Math.max(3, perDay * 0.5)).map((v) => Math.max(...v) - Math.min(...v));
  const dailyMedians = [...dayGroups.entries()].map(([k, v]) => ({ k, m: median(v), n: v.length }));
  const weekly: number[] = [];
  for (let w = pts[0].t; w < pts[pts.length - 1].t; w += 7 * DAY) {
    const vs = pts.filter((p) => p.t >= w && p.t < w + 7 * DAY).map((p) => p.v);
    if (vs.length >= 5) weekly.push(median(vs));
  }
  const drift = weekly.length ? Math.max(...weekly) - Math.min(...weekly) : NaN;

  let tempCorr: string | null = null;
  const tp = pts.filter((p) => p.temp !== undefined);
  if (tp.length > 20) {
    const mx = tp.reduce((s, p) => s + p.temp!, 0) / tp.length;
    const dt = tp.map((p) => p.temp! - mx);
    const r = detr.filter((_, i) => pts[i].temp !== undefined);
    const mr = r.reduce((s, x) => s + x, 0) / r.length;
    const cov = dt.reduce((s, d, i) => s + d * (r[i] - mr), 0);
    const vt = dt.reduce((s, d) => s + d * d, 0);
    const vr = r.reduce((s, x) => s + (x - mr) ** 2, 0);
    tempCorr = `corr(detrended, temp)=${fmt(cov / Math.sqrt(vt * vr), 2)}  slope=${fmt(cov / vt, 4)}/°C`;
  }

  console.log(`\n● ${sensor.name || sensor["scanin-id"] || id}  [${sensor.type}]  axis=${axis}  ${days}d  (${id})`);
  console.log(`  samples=${pts.length}  cadence≈${fmt(cadenceMin, 0)} min (${fmt(perDay, 1)}/day)  suspect=${suspect} replay=${replay}  initial=${initial}`);
  console.log(`  thresholds: warn=±${warn}  alarm=±${alarm}`);
  console.log(`\n  ANATOMY (adjusted units)`);
  console.log(`    current value (24h median)   ${fmt(c24[c24.length - 1])}`);
  console.log(`    drift  (range of weekly medians) ${fmt(drift)}`);
  console.log(`    diurnal peak-to-peak             ${fmt(diurnalPP)}   (hour-of-day profile)`);
  console.log(`    daily range  median / p90        ${fmt(median(dailyRanges))} / ${fmt([...dailyRanges].sort((a, b) => a - b)[Math.floor(dailyRanges.length * 0.9)])}`);
  console.log(`    noise σ (robust, after diurnal)  ${fmt(sigma)}`);
  console.log(`    spikes (>5σ)                     ${spikes} (${fmt((spikes / pts.length) * 100, 2)}%)`);
  if (tempCorr) console.log(`    temperature                      ${tempCorr}`);
  console.log(`    warn gap / diurnal p-p           ${fmt(warn / diurnalPP, 2)}×     warn gap / noise σ  ${fmt(warn / sigma, 1)}×`);
  const prof = profile.map((x) => (Number.isFinite(x) ? x : 0));
  const pmin = Math.min(...prof);
  const pmax = Math.max(...prof);
  const bars = "▁▂▃▄▅▆▇█";
  console.log(`    hour profile 00→23  ${prof.map((x) => bars[Math.round(((x - pmin) / (pmax - pmin || 1)) * 7)]).join("")}`);
  const dm = dailyMedians.map((d) => d.m);
  const dmin = Math.min(...dm);
  const dmax = Math.max(...dm);
  console.log(`    daily medians      ${dm.map((x) => bars[Math.round(((x - dmin) / (dmax - dmin || 1)) * 7)]).join("")}  [${fmt(dmin)} … ${fmt(dmax)}]`);

  if (!Number.isFinite(warn) || !Number.isFinite(alarm)) {
    console.log("\n  (no thresholds on this axis — pass --warn= --alarm= to simulate)");
    return;
  }

  // ---- strategies
  const trailing = (fn: (v: number[]) => number, hours: number) => pts.map((p, i) => ({ t: p.t, v: fn(windowVals(pts, i, hours * H, 0)) }));
  const raw = pts.map((p) => ({ t: p.t, v: p.v }));
  let e = pts[0].v;
  const ema = pts.map((p) => ({ t: p.t, v: (e = 0.05 * p.v + 0.95 * e) }));
  // Hampel (causal): reject samples > 3·MAD from trailing 24h median, then trailing trimmed mean
  const clean: P[] = [];
  pts.forEach((p, i) => {
    const w = windowVals(pts, i, 24 * H, 0);
    const m = median(w);
    const s = 1.4826 * mad(w) || Infinity;
    if (w.length < 6 || Math.abs(p.v - m) <= 3 * s) clean.push(p);
  });
  const robust = pts.map((p) => {
    const w = clean.filter((c) => c.t > p.t - 24 * H && c.t <= p.t).map((c) => c.v);
    return { t: p.t, v: w.length >= Math.max(3, perDay * 0.25) ? trimmedMean(w, 0.2) : NaN };
  });
  const dailyEval = (() => {
    // value only changes at day end (like prism-daily), held until the next day
    const out: { t: number; v: number }[] = [];
    [...dayGroups.entries()].forEach(([k, v]) => {
      const t = Date.parse(`${k}T23:59:00+03:00`);
      if (v.length >= 3) out.push({ t, v: trimmedMean(v, 0.2) });
    });
    return out;
  })();

  const rows: [string, ReturnType<typeof simulate>][] = [
    ["raw (today's alerts)", simulate(raw, warn, alarm)],
    ["EMA α=0.05 (today's EMA)", simulate(ema, warn, alarm)],
    ["trailing 24h trimmed-mean 20% (UI MA)", simulate(trailing((v) => trimmedMean(v, 0.2), 24), warn, alarm)],
    ["trailing 24h median", simulate(trailing(median, 24), warn, alarm)],
    ["Hampel→24h trimmed mean", simulate(robust, warn, alarm)],
    ["Hampel→24h trimmed mean + persist 3", simulate(robust, warn, alarm, 3)],
    ["daily trimmed mean (prism-daily style)", simulate(dailyEval, warn, alarm)],
  ];
  console.log(`\n  STRATEGY SIMULATION (same rules as checkThresholds, 24h throttle)`);
  console.log(`    ${"strategy".padEnd(40)} alerts  flips  %time warn/alarm`);
  rows.forEach(([n, r]) => console.log(`    ${n.padEnd(40)} ${String(r.alerts).padStart(6)} ${String(r.flips).padStart(6)} ${fmt(r.pctNonOk, 1).padStart(8)}%`));
  const rawThr = Math.max(alarm * 2.5, alarm + 4 * sigma + diurnalPP / 2);
  console.log(`\n  Tier-1 raw sanity: raw |v| > ${fmt(rawThr)} (≈ max(2.5×alarm, alarm + diurnal/2 + 4σ)) → ${raw.filter((r) => Math.abs(r.v) > rawThr).length} samples`);

  if (args.csv) {
    const out = path.resolve(__dirname, `../../out/signal-${id}-${axis}.csv`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tm = trailing((v) => trimmedMean(v, 0.2), 24);
    fs.writeFileSync(out, ["time,iso,raw,ema,trimmed24,robust24,centred24median", ...pts.map((p, i) => [p.t, new Date(p.t).toISOString(), p.v, ema[i].v, tm[i].v, robust[i].v, c24[i]].join(","))].join("\n"));
    console.log(`  📄 ${out}`);
  }
  console.log();
});
