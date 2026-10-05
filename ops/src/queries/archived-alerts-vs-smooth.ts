/**
 * Were the archived legacy alerts real? (read-only)
 * For each archived alert (from the local backup JSON), find the sample that
 * triggered it (latest data-log doc at/before alert.sampleTime ?? alert.time)
 * and compare its stored smooth.<axis> with the alert's own thresholds:
 *   confirmed      |smooth| ≥ gap of the alert's severity
 *   confirmed-warn alarm alert, smooth only beyond the warn gap
 *   raw-only       smooth inside the warn gap → fired by a raw spike
 *   no-smooth      sample has no smooth (older than the backfill / not smoothed)
 *   no-threshold   alert has no gap-format thresholds (legacy min/max)
 * Usage: npx tsx src/queries/archived-alerts-vs-smooth.ts --backup=out/alerts-archive-backup-<ts>.json [--days=95]
 */
import fs from "fs";
import path from "path";
import { db } from "../lib/firebase";
import { num, parseArgs, run, str } from "../lib/cli";

const DAILY_TO_RAW: Record<string, string> = {
  daily2Ddisplacement: "TwoDDisplacement",
  dailyTwoDDisplacement: "TwoDDisplacement",
  dailySettlement: "HeightDisplacement",
  dailyEastingDisplacement: "EastingDisplacement",
  dailyNorthingDisplacement: "NorthingDisplacement",
};

type Verdict = "confirmed" | "confirmed-warn" | "raw-only" | "no-smooth" | "no-threshold" | "no-sample";

run(async () => {
  const args = parseArgs();
  const backupPath = path.resolve(__dirname, "../..", str(args.backup) ?? "");
  const since = Date.now() - num(args.days, 95) * 864e5;
  const all: any[] = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const alerts = all.filter((a) => (a.sampleTime ?? a.time) >= since && a.sensorDocId && a.axis);
  console.log(`archived: ${all.length}; in the last ${num(args.days, 95)}d with sensorDocId+axis: ${alerts.length}`);

  const verdicts = new Map<Verdict, number>();
  const perSensor = new Map<string, Record<Verdict, number>>();

  const classify = async (a: any): Promise<Verdict> => {
    const warn = a.threshold?.warn?.gap, alarm = a.threshold?.alarm?.gap;
    if (typeof warn !== "number" && typeof alarm !== "number") return "no-threshold";
    const t = a.sampleTime ?? a.time;
    const snap = await db
      .collection(`work-sensors/${a.sensorDocId}/data-log`)
      .where("time", "<=", t)
      .orderBy("time", "desc")
      .limit(3)
      .get();
    const sample = snap.docs.map((d) => d.data()).find((d) => d.time !== undefined);
    if (!sample) return "no-sample";
    const axis = DAILY_TO_RAW[a.axis] ?? a.axis;
    const s = sample.smooth?.[axis];
    if (typeof s !== "number") return "no-smooth";
    const v = Math.abs(s);
    const sevGap = a.severity === "alarm" ? alarm ?? warn : warn ?? alarm;
    if (v >= sevGap) return "confirmed";
    if (a.severity === "alarm" && typeof warn === "number" && v >= warn) return "confirmed-warn";
    return "raw-only";
  };

  const CONC = 40;
  for (let i = 0; i < alerts.length; i += CONC) {
    const chunk = alerts.slice(i, i + CONC);
    const res = await Promise.all(chunk.map((a) => classify(a).catch(() => "no-sample" as Verdict)));
    res.forEach((v, j) => {
      verdicts.set(v, (verdicts.get(v) ?? 0) + 1);
      const k = `${chunk[j].location?.site ?? "?"} / ${chunk[j].sensor}`;
      const rec = perSensor.get(k) ?? ({} as Record<Verdict, number>);
      rec[v] = (rec[v] ?? 0) + 1;
      perSensor.set(k, rec);
    });
    if ((i / CONC) % 25 === 0) process.stdout.write(`  ${i + chunk.length}/${alerts.length}\r`);
  }

  console.log("\nverdicts:");
  [...verdicts].sort((a, b) => b[1] - a[1]).forEach(([v, n]) => console.log(`  ${String(n).padStart(6)}  ${v}`));
  console.log("\nsensors with the most smooth-confirmed alerts:");
  [...perSensor]
    .map(([k, r]) => ({ k, c: (r.confirmed ?? 0) + (r["confirmed-warn"] ?? 0), r }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c)
    .slice(0, 20)
    .forEach((x) => console.log(`  ${String(x.c).padStart(5)}  ${x.k}  ${JSON.stringify(x.r)}`));
});
