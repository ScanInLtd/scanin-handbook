/**
 * Read-only: is the noise common to all prisms of a site (station / run level) or per prism?
 *
 * Groups samples into ATS "runs" (all prisms measured within --gap minutes of each other),
 * computes each prism's deviation from its own rolling 3-day median, and per run the
 * median deviation across prisms (= common-mode). If common-mode explains most of the
 * per-prism deviation, the fix is run-level validation / differential correction, not smoothing.
 *
 * Usage: npx tsx src/analysis/common-mode.ts <projectId|name> [--axis=HeightDisplacement] [--days=30] [--gap=30]
 */
import { db } from "../lib/firebase";
import { num, parseArgs, run, str } from "../lib/cli";
import { projectSensors, resolveProject } from "../lib/sensors";

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
};
const H = 3.6e6;

run(async () => {
  const args = parseArgs();
  const project = await resolveProject(args._[0] ?? "");
  const axis = str(args.axis) ?? "HeightDisplacement";
  const days = num(args.days, 30);
  const gapMs = num(args.gap, 30) * 6e4;
  const from = Date.now() - days * 24 * H;

  const sensors = (await projectSensors(project.id, "prism")).filter((s) => s.data.active !== false);
  console.log(`\n● ${project.name}: ${sensors.length} active prisms, axis=${axis}, ${days}d`);

  type S = { sid: string; t: number; v: number };
  const all: S[] = [];
  await Promise.all(
    sensors.map(async (s) => {
      const snap = await db.collection(`work-sensors/${s.id}/data-log`).where("time", ">=", from).orderBy("time").get();
      snap.docs.forEach((d) => {
        if (d.id.startsWith("daily::")) return;
        const v = parseFloat(d.data()[axis]);
        if (Number.isFinite(v)) all.push({ sid: s.id, t: d.data().time, v });
      });
    }),
  );
  all.sort((a, b) => a.t - b.t);

  // per-prism deviation from own centred 3-day median
  const bySensor = new Map<string, S[]>();
  all.forEach((x) => (bySensor.get(x.sid) ?? bySensor.set(x.sid, []).get(x.sid)!).push(x));
  const dev = new Map<S, number>();
  for (const arr of bySensor.values()) {
    arr.forEach((x) => {
      const w = arr.filter((y) => Math.abs(y.t - x.t) <= 36 * H).map((y) => y.v);
      dev.set(x, x.v - median(w));
    });
  }

  // cluster into runs
  const runs: S[][] = [];
  for (const x of all) {
    const last = runs[runs.length - 1];
    if (last && x.t - last[last.length - 1].t <= gapMs) last.push(x);
    else runs.push([x]);
  }
  const big = runs.filter((r) => new Set(r.map((x) => x.sid)).size >= Math.max(3, sensors.length * 0.3));
  console.log(`  ${all.length} samples in ${runs.length} runs (${big.length} runs with ≥30% of prisms)`);

  let totVar = 0;
  let resVar = 0;
  const cmList: { t: number; cm: number; n: number; spread: number }[] = [];
  for (const r of big) {
    const devs = r.map((x) => dev.get(x)!);
    const cm = median(devs);
    const spread = median(devs.map((d) => Math.abs(d - cm)));
    cmList.push({ t: r[0].t, cm, n: r.length, spread });
    devs.forEach((d) => {
      totVar += d * d;
      resVar += (d - cm) ** 2;
    });
  }
  console.log(`  variance explained by common-mode (per run): ${((1 - resVar / totVar) * 100).toFixed(0)}%`);
  const absCm = cmList.map((c) => Math.abs(c.cm)).sort((a, b) => a - b);
  const q = (p: number) => absCm[Math.floor(p * (absCm.length - 1))];
  console.log(`  |common-mode| per run: median=${q(0.5).toFixed(2)} p90=${q(0.9).toFixed(2)} max=${q(1).toFixed(2)}   within-run spread median=${median(cmList.map((c) => c.spread)).toFixed(2)}`);

  const byHour = new Map<number, number[]>();
  cmList.forEach((c) => {
    const h = Number(new Date(c.t).toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" })) % 24;
    (byHour.get(h) ?? byHour.set(h, []).get(h)!).push(c.cm);
  });
  console.log(`\n  common-mode by run hour (Asia/Jerusalem): median  [n]`);
  [...byHour].sort((a, b) => a[0] - b[0]).forEach(([h, v]) => console.log(`    ${String(h).padStart(2)}:00  ${median(v).toFixed(2).padStart(7)}  [${v.length}]  ${"▮".repeat(Math.min(40, Math.round(Math.abs(median(v)) * 4)))}`));

  console.log(`\n  worst runs:`);
  [...cmList].sort((a, b) => Math.abs(b.cm) - Math.abs(a.cm)).slice(0, 10).forEach((c) =>
    console.log(`    ${new Date(c.t).toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" })}  common-mode=${c.cm.toFixed(2)}  prisms=${c.n}  spread=${c.spread.toFixed(2)}`),
  );
  console.log();
});
