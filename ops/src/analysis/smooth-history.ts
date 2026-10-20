/**
 * Read-only: per sensor, per month — samples, % with `smooth`, % suspect, samples/day.
 * Answers "why does the report have holes": no smooth yet (outside the backfill), sparse data
 * (min-n / diurnal coverage), or suspect.
 * Usage: npx tsx src/analysis/smooth-history.ts <projectId|name> [--type=prism] [--from=2025-10-01] [--limit=8]
 */
import { db } from "../lib/firebase";
import { num, parseArgs, parseWhen, run, str } from "../lib/cli";
import { projectSensors, resolveProject } from "../lib/sensors";

run(async () => {
  const args = parseArgs();
  const project = await resolveProject(args._[0] ?? "");
  const from = parseWhen(str(args.from) ?? "365d", 0);
  const sensors = (await projectSensors(project.id, str(args.type))).filter((s) => s.data.active !== false).slice(0, num(args.limit, 8));
  console.log(`\n● ${project.name}: ${sensors.length} sensors (first ${num(args.limit, 8)}), since ${new Date(from).toISOString().slice(0, 10)}`);
  console.log(`  cell = samples · %smooth · %suspect · hours of day covered\n`);

  const months = new Set<string>();
  const table = new Map<string, Map<string, { n: number; sm: number; su: number; hours: Set<number> }>>();
  for (const s of sensors) {
    const snap = await db.collection(`work-sensors/${s.id}/data-log`).where("time", ">=", from).get();
    const m = new Map<string, { n: number; sm: number; su: number; hours: Set<number> }>();
    snap.docs.forEach((d) => {
      if (d.id.startsWith("daily::")) return;
      const x = d.data();
      if (typeof x.time !== "number") return;
      const k = new Date(x.time).toISOString().slice(0, 7);
      months.add(k);
      const e = m.get(k) ?? { n: 0, sm: 0, su: 0, hours: new Set<number>() };
      e.n++;
      if (x.smooth && Object.keys(x.smooth).some((a) => !["n", "w", "v", "q", "replayN"].includes(a))) e.sm++;
      if (x.suspect === true) e.su++;
      e.hours.add(Number(new Date(x.time).toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" })) % 24);
      m.set(k, e);
    });
    table.set(`${s.label} (${s.id.slice(0, 6)})`, m);
  }
  const ms = [...months].sort();
  console.log(`${"sensor".padEnd(26)} ${ms.map((k) => k.padEnd(17)).join("")}`);
  for (const [name, m] of table) {
    console.log(`${name.slice(0, 26).padEnd(26)} ${ms.map((k) => {
      const e = m.get(k);
      return (e ? `${e.n}·${Math.round((e.sm / e.n) * 100)}%·${Math.round((e.su / e.n) * 100)}%·${e.hours.size}h` : "—").padEnd(17);
    }).join("")}`);
  }
});
