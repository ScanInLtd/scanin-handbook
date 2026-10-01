/**
 * Read-only: alert timeline for one sensor — per-day counts and spacing between consecutive alerts
 * (diagnoses throttle failures / bursts / backfill storms).
 * Usage: npx tsx src/analysis/alert-timeline.ts <sensorDocId> [--since=60d] [--axis=HeightDisplacement] [--list]
 */
import { db } from "../lib/firebase";
import { fmtTime, parseArgs, parseWhen, run, str } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const id = args._[0];
  if (!id) throw new Error("usage: alert-timeline.ts <sensorDocId>");
  const since = parseWhen(str(args.since) ?? "60d", 0);

  const snap = await db.collection("alerts").where("sensorDocId", "==", id).get();
  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>).filter((a) => a.time >= since);
  if (args.axis) rows = rows.filter((a) => a.axis === args.axis);
  rows.sort((a, b) => a.time - b.time);
  console.log(`${rows.length} alerts for ${id} since ${fmtTime(since)}`);

  const perDay = new Map<string, number>();
  rows.forEach((a) => {
    const day = new Date(a.time).toISOString().slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  });
  console.log("\nPer day:");
  [...perDay].forEach(([d, n]) => console.log(`  ${d}  ${"█".repeat(Math.min(n, 80))} ${n}`));

  const gaps = rows.slice(1).map((a, i) => (a.time - rows[i].time) / 6e4);
  if (gaps.length) {
    const sorted = [...gaps].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
    console.log(`\nMinutes between consecutive alerts: min=${q(0).toFixed(1)} p10=${q(0.1).toFixed(1)} median=${q(0.5).toFixed(1)} p90=${q(0.9).toFixed(1)}`);
    console.log(`  < 1 min apart: ${gaps.filter((g) => g < 1).length}   < 24h apart: ${gaps.filter((g) => g < 1440).length}`);
  }

  const bySample = new Map<string, number>();
  rows.forEach((a) => {
    const k = `${a.axis}|${a.sampleTime ?? a.data?.time ?? a.trigger}`;
    bySample.set(k, (bySample.get(k) ?? 0) + 1);
  });

  if (args.list) rows.forEach((a) => console.log(`${fmtTime(a.time)}  ${a.axis}  ${a.prev_level}→${a.new_level}  value=${a.actualValue}  raw=${a.rawValue}`));
});
