/**
 * Read-only: find persistent level shifts (steps) in sensor series — device moved/replaced,
 * station re-setup, prism reassigned, new initial value — and group them by project+day
 * to see station-wide events.
 *
 * A step = daily median changes by > --min (default: 3× the sensor's warn gap) and the next
 * 2 days stay on the new level (within half the step), i.e. not a one-day glitch.
 *
 * Usage: npx tsx src/analysis/level-shifts.ts [--days=180] [--type=prism] [--project=<id|name>] [--min=]
 */
import { db } from "../lib/firebase";
import { list, num, parseArgs, run, str } from "../lib/cli";
import { projectName, sensorLabel } from "../lib/sensors";
import { DAY, median } from "../lib/signal";

const PRISM_AXES = ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"];

run(async () => {
  const args = parseArgs();
  const days = num(args.days, 180);
  const from = Date.now() - days * DAY;
  const types = list(args.type);

  let projects = (await db.collection("projects").where("isActive", "==", true).get()).docs.map((d) => ({ id: d.id, name: projectName(d.data()) }));
  if (args.project) projects = projects.filter((p) => p.id === args.project || p.name.includes(String(args.project)));

  type Step = { project: string; sensor: string; label: string; axis: string; day: string; before: number; after: number; size: number };
  const steps: Step[] = [];
  let scanned = 0;

  for (const p of projects) {
    const snap = await db.collection("work-sensors").where("location.site", "==", p.id).get();
    const sensors = snap.docs.filter((d) => d.data().active !== false && (!types.length || types.includes(d.data().type)));
    await Promise.all(
      sensors.map(async (s) => {
        const d = s.data();
        const axes = d.type === "prism" ? PRISM_AXES : Object.keys(d.thresholds?.axes ?? {}).filter((a) => !a.startsWith("daily"));
        if (!axes.length) return;
        const log = await db.collection(`work-sensors/${s.id}/data-log`).where("time", ">=", from).orderBy("time").get();
        const docs = log.docs.filter((x) => !x.id.startsWith("daily::")).map((x) => x.data());
        scanned++;
        for (const axis of axes) {
          const byDay = new Map<string, number[]>();
          docs.forEach((x) => {
            const v = parseFloat(x[axis]);
            if (!Number.isFinite(v)) return;
            const k = new Date(x.time).toLocaleDateString("sv-SE", { timeZone: "Asia/Jerusalem" });
            (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(v);
          });
          const dm = [...byDay].filter(([, v]) => v.length >= 2).map(([k, v]) => ({ k, m: median(v) }));
          const warn = Number(d.thresholds?.axes?.[axis]?.warn?.gap);
          const min = num(args.min, Number.isFinite(warn) ? 3 * warn : d.type === "prism" ? 15 : NaN);
          if (!Number.isFinite(min)) continue;
          for (let i = 1; i < dm.length - 2; i++) {
            const step = dm[i].m - dm[i - 1].m;
            if (Math.abs(step) < min) continue;
            const persists = [dm[i + 1].m, dm[i + 2].m].every((m) => Math.abs(m - dm[i].m) < Math.abs(step) / 2);
            if (persists) steps.push({ project: p.name, sensor: s.id, label: sensorLabel(d, s.id), axis, day: dm[i].k, before: dm[i - 1].m, after: dm[i].m, size: step });
          }
        }
      }),
    );
  }

  console.log(`\nScanned ${scanned} sensors in ${projects.length} active projects over ${days}d → ${steps.length} persistent steps\n`);
  const events = new Map<string, Step[]>();
  steps.forEach((s) => {
    const k = `${s.day}  ${s.project}`;
    (events.get(k) ?? events.set(k, []).get(k)!).push(s);
  });
  console.log("Events (project + day): sensors stepping together");
  [...events].sort((a, b) => a[0].localeCompare(b[0])).forEach(([k, ss]) => {
    const sensorsN = new Set(ss.map((s) => s.sensor)).size;
    const sizes = ss.map((s) => Math.abs(s.size));
    console.log(`  ${k.padEnd(48)} sensors=${String(sensorsN).padStart(3)}  |step| median=${median(sizes).toFixed(1)} max=${Math.max(...sizes).toFixed(1)}  e.g. ${ss.slice(0, 3).map((s) => `${s.label}.${s.axis.replace("Displacement", "")} ${s.before.toFixed(1)}→${s.after.toFixed(1)}`).join(", ")}`);
  });
  console.log();
});
