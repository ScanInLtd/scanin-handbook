/**
 * Read-only: per day, across a project's active prisms (or one type): samples, prisms with data,
 * % of samples with `smooth`, % suspect — tells data gaps from MA gaps.
 * Usage: npx tsx src/analysis/smooth-daily.ts <projectId|name> --from=2026-09-17 --to=2026-10-21 [--type=prism] [--sensor=<name>]
 */
import { db } from "../lib/firebase";
import { parseArgs, parseWhen, run, str } from "../lib/cli";
import { projectSensors, resolveProject } from "../lib/sensors";

run(async () => {
  const args = parseArgs();
  const project = await resolveProject(args._[0] ?? "");
  const from = parseWhen(str(args.from) ?? "30d", 0), to = parseWhen(str(args.to), Date.now());
  let sensors = (await projectSensors(project.id, str(args.type) ?? "prism")).filter((s) => s.data.active !== false);
  if (str(args.sensor)) sensors = sensors.filter((s) => String(s.label) === str(args.sensor));
  const day = (t: number) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Asia/Jerusalem" });
  const rows = new Map<string, { n: number; sm: number; su: number; prisms: Set<string>; noSmPrisms: Set<string> }>();
  for (const s of sensors) {
    const snap = await db.collection(`work-sensors/${s.id}/data-log`).where("time", ">=", from).where("time", "<=", to).get();
    for (const d of snap.docs) {
      if (d.id.startsWith("daily::")) continue;
      const x = d.data();
      if (typeof x.time !== "number") continue;
      const k = day(x.time);
      const r = rows.get(k) ?? { n: 0, sm: 0, su: 0, prisms: new Set(), noSmPrisms: new Set() };
      r.n++; r.prisms.add(s.id);
      const has = x.smooth && Object.keys(x.smooth).some((a) => !["n", "w", "v", "q", "replayN"].includes(a));
      if (has) r.sm++; else r.noSmPrisms.add(String(s.label));
      if (x.suspect === true) r.su++;
      rows.set(k, r);
    }
  }
  console.log(`\n● ${project.name}: ${sensors.length} sensors, ${day(from)} → ${day(to)}\n`);
  console.log(`day         prisms  samples  smooth%  suspect%  per-prism/day`);
  for (let t = from; t <= to; t += 864e5) {
    const k = day(t), r = rows.get(k);
    if (!r) { console.log(`${k}   —  no data`); continue; }
    console.log(`${k}  ${String(r.prisms.size).padStart(5)}  ${String(r.n).padStart(7)}  ${String(Math.round((r.sm / r.n) * 100)).padStart(6)}%  ${String(Math.round((r.su / r.n) * 100)).padStart(7)}%  ${(r.n / r.prisms.size).toFixed(1).padStart(6)}`);
  }
});
