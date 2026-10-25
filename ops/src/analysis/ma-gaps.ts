/**
 * Read-only: gaps in the MA (`smooth`) series of a project's prisms — what the reports show as holes.
 *
 * For every active prism sample since --from (default 365d), was `smooth` stored? If not, WHY, using the
 * same gates as functions `smoothing.ts` (window 48h for prisms, reset baseline events cut the window,
 * continuity events (`continuity: true` / reason 'iron') don't, suspect samples excluded,
 * minN = max(3, ceil(expected-per-window / 4)) with expected from the median spacing, ≥ 3 of the 4
 * six-hour day quarters covered):
 *   recomputable  the window passes the gates → a recompute would fill it (not computed / outside backfill)
 *   min-n         too few samples in the window (sparse data or just after a gap)
 *   coverage      enough samples but < 3 day-quarters (e.g. readings only at night)
 *   after-reset   the window was cut by a reset event and hasn't refilled yet
 *   suspect       the sample itself is suspect (never smoothed)
 * Also per sensor: "report holes" = runs of consecutive non-smoothed samples spanning ≥ 24h, and data
 * gaps (no samples at all) ≥ 48h, which no recompute can fill.
 *
 * Approximation: the gate check uses each axis' raw values only through presence (it doesn't redo the MAD
 * outlier trim), so `recomputable` can slightly over-count where many samples are outliers.
 *
 * Usage: npx tsx src/analysis/ma-gaps.ts <projectId|name>[,<projectId|name>…] [--from=365d|YYYY-MM-DD] [--sensors] [--json=out/ma-gaps.json]
 *        npx tsx src/analysis/ma-gaps.ts --all-active [--from=365d]        (every active project with active prisms)
 */
import fs from "fs";
import path from "path";
import { db } from "../lib/firebase";
import { list, parseArgs, parseWhen, run, str } from "../lib/cli";
import { projectSensors, resolveProject } from "../lib/sensors";

const WINDOW_MS = 48 * 3600 * 1000; // prism window (functions WINDOW_MS_BY_TYPE.prism)
const DAY_MS = 24 * 3600 * 1000;
const QUARTER_MS = DAY_MS / 4;
const AXES = ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"];
const HOLE_MS = DAY_MS; // report-visible hole: ≥ 24h without MA
const DATA_GAP_MS = 2 * DAY_MS;

type Reason = "smoothed" | "recomputable" | "min-n" | "coverage" | "after-reset" | "suspect";
const REASONS: Reason[] = ["smoothed", "recomputable", "min-n", "coverage", "after-reset", "suspect"];

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function hasSmooth(x: any): boolean {
  return !!x.smooth && AXES.some((a) => typeof x.smooth[a] === "number");
}

function hasAxisValue(x: any): boolean {
  return AXES.some((a) => Number.isFinite(parseFloat(x[a])));
}

interface Sample { time: number; smoothed: boolean; suspect: boolean }

/** Gate check for the window ending at sample i (functions computeSmooth + filterWindow, presence only) */
function classify(samples: Sample[], i: number, resets: number[]): Reason {
  const s = samples[i];
  if (s.smoothed) return "smoothed";
  if (s.suspect) return "suspect";
  const end = s.time;
  let start = end - WINDOW_MS;
  const lastReset = resets.filter((r) => r <= end).pop();
  const cutByReset = lastReset !== undefined && lastReset > start;
  if (cutByReset) start = lastReset!;
  const win: number[] = [];
  for (let j = i; j >= 0 && samples[j].time >= start; j--) if (!samples[j].suspect) win.push(samples[j].time);
  win.reverse();
  const gaps: number[] = [];
  for (let k = 1; k < win.length; k++) if (win[k] - win[k - 1] > 0) gaps.push(win[k] - win[k - 1]);
  const medGap = median(gaps);
  const expected = medGap > 0 ? WINDOW_MS / medGap : 0;
  const minN = Math.max(3, Math.ceil(expected / 4));
  if (win.length < minN) return cutByReset ? "after-reset" : "min-n";
  const winStart = end - WINDOW_MS;
  const q = new Set<number>();
  for (const t of win) {
    const folded = ((t - winStart) % DAY_MS + DAY_MS) % DAY_MS;
    q.add(Math.min(3, Math.floor(folded / QUARTER_MS)));
  }
  if (q.size < 3) return cutByReset ? "after-reset" : "coverage";
  return "recomputable";
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");

run(async () => {
  const args = parseArgs();
  let keys = list(args._[0] ?? "");
  if (args["all-active"]) {
    // every active project that has at least one active prism
    const projects = await db.collection("projects").where("isActive", "==", true).get();
    keys = [];
    for (const p of projects.docs) {
      const prisms = await db.collection("work-sensors").where("location.site", "==", p.id).where("type", "==", "prism").get();
      if (prisms.docs.some((s) => s.data().active !== false)) keys.push(p.id);
    }
    console.log(`all-active: ${keys.length} active projects with active prisms`);
  }
  if (!keys.length) throw new Error("project id or name required (comma-separated for several), or --all-active");
  const from = parseWhen(str(args.from) ?? "365d", 0);
  const jsonOut: any[] = [];

  for (const key of keys) {
    const project = await resolveProject(key);
    const sensors = (await projectSensors(project.id, "prism")).filter((s) => s.data.active !== false);
    const months = new Map<string, Record<Reason, number> & { n: number }>();
    const perSensor: any[] = [];

    for (const s of sensors) {
      const [logSnap, evSnap] = await Promise.all([
        db.collection(`work-sensors/${s.id}/data-log`).where("time", ">=", from).get(),
        db.collection(`work-sensors/${s.id}/baseline-events`).get(),
      ]);
      const resets = evSnap.docs
        .map((d) => d.data())
        .filter((e) => typeof e.time === "number" && e.continuity !== true && e.reason !== "iron")
        .map((e) => e.time as number)
        .sort((a, b) => a - b);
      const samples: Sample[] = logSnap.docs
        .filter((d) => !d.id.startsWith("daily::"))
        .map((d) => d.data())
        .filter((x) => typeof x.time === "number" && x.isReplay !== true && x.source !== "replay" && x.source !== "derived:daily" && hasAxisValue(x))
        .map((x) => ({ time: x.time as number, smoothed: hasSmooth(x), suspect: x.suspect === true }))
        .sort((a, b) => a.time - b.time);

      const counts: Record<Reason, number> = { smoothed: 0, recomputable: 0, "min-n": 0, coverage: 0, "after-reset": 0, suspect: 0 };
      let holeDays = 0, holes = 0, runStart: number | null = null, lastNon = 0;
      let dataGapDays = 0, dataGaps = 0;
      samples.forEach((smp, i) => {
        const r = classify(samples, i, resets);
        counts[r]++;
        const mk = new Date(smp.time).toISOString().slice(0, 7);
        const m = months.get(mk) ?? Object.assign({ n: 0 }, Object.fromEntries(REASONS.map((x) => [x, 0])) as Record<Reason, number>);
        m.n++;
        m[r]++;
        months.set(mk, m);
        if (i > 0 && smp.time - samples[i - 1].time >= DATA_GAP_MS) {
          dataGaps++;
          dataGapDays += (smp.time - samples[i - 1].time) / DAY_MS;
        }
        if (r !== "smoothed" && r !== "suspect") {
          if (runStart === null) runStart = smp.time;
          lastNon = smp.time;
        } else if (r === "smoothed" && runStart !== null) {
          if (lastNon - runStart >= HOLE_MS) { holes++; holeDays += (lastNon - runStart) / DAY_MS; }
          runStart = null;
        }
      });
      if (runStart !== null && lastNon - runStart >= HOLE_MS) { holes++; holeDays += (lastNon - runStart) / DAY_MS; }
      perSensor.push({
        id: s.id, name: s.label, n: samples.length, ...counts,
        holes, holeDays: Math.round(holeDays), dataGaps, dataGapDays: Math.round(dataGapDays),
        first: samples[0]?.time, last: samples[samples.length - 1]?.time,
      });
    }

    const tot = perSensor.reduce((a, s) => { a.n += s.n; REASONS.forEach((r) => (a[r] += s[r])); return a; },
      Object.assign({ n: 0 }, Object.fromEntries(REASONS.map((r) => [r, 0]))) as any);
    console.log(`\n● ${project.name} (${project.id}) — ${sensors.length} active prisms, since ${new Date(from).toISOString().slice(0, 10)}`);
    console.log(`  samples ${tot.n}: with MA ${pct(tot.smoothed, tot.n)} · missing but RECOMPUTABLE ${pct(tot.recomputable, tot.n)} · min-n ${pct(tot["min-n"], tot.n)} · coverage ${pct(tot.coverage, tot.n)} · after-reset ${pct(tot["after-reset"], tot.n)} · suspect ${pct(tot.suspect, tot.n)}`);
    console.log(`  report holes (≥24h without MA): ${perSensor.reduce((a, s) => a + s.holes, 0)} on ${perSensor.filter((s) => s.holes).length} prisms, ${perSensor.reduce((a, s) => a + s.holeDays, 0)} prism-days · data gaps ≥48h: ${perSensor.reduce((a, s) => a + s.dataGaps, 0)} (${perSensor.reduce((a, s) => a + s.dataGapDays, 0)} prism-days)`);
    console.log(`  month     samples   MA    recomp  min-n  cover  reset  suspect`);
    [...months.keys()].sort().forEach((k) => {
      const m = months.get(k)!;
      console.log(`  ${k}  ${String(m.n).padStart(7)}  ${pct(m.smoothed, m.n).padStart(4)}  ${pct(m.recomputable, m.n).padStart(6)}  ${pct(m["min-n"], m.n).padStart(5)}  ${pct(m.coverage, m.n).padStart(5)}  ${pct(m["after-reset"], m.n).padStart(5)}  ${pct(m.suspect, m.n).padStart(7)}`);
    });
    if (args.sensors) {
      console.log(`  per prism (worst first):`);
      perSensor
        .sort((a, b) => b.holeDays - a.holeDays || a.smoothed / (a.n || 1) - b.smoothed / (b.n || 1))
        .forEach((s) => console.log(`    ${String(s.name).slice(0, 22).padEnd(22)} n=${String(s.n).padStart(5)}  MA ${pct(s.smoothed, s.n).padStart(4)}  recomp ${pct(s.recomputable, s.n).padStart(4)}  min-n ${pct(s["min-n"], s.n).padStart(4)}  cover ${pct(s.coverage, s.n).padStart(4)}  holes ${s.holes} (${s.holeDays}d)  data-gaps ${s.dataGaps} (${s.dataGapDays}d)`));
    }
    jsonOut.push({ project: { id: project.id, name: project.name }, from, totals: tot, months: Object.fromEntries(months), sensors: perSensor });
  }

  const out = str(args.json);
  if (out) {
    const p = path.resolve(__dirname, "../..", out);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(jsonOut, null, 1));
    console.log(`\njson: ${p}`);
  }
});
