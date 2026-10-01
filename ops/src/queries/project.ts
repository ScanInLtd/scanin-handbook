/**
 * List a project's sensors with their last raw sample time (finds silent sensors).
 * Usage: npx tsx src/queries/project.ts <projectId|name fragment> [--type=prism] [--stale=24h]
 *        npx tsx src/queries/project.ts --list          (all projects with sensor counts)
 */
import { db } from "../lib/firebase";
import { fmtTime, parseArgs, parseWhen, run, str, toMs } from "../lib/cli";
import { projectName, projectSensors, resolveProject } from "../lib/sensors";

run(async () => {
  const args = parseArgs();

  if (args.list || !args._[0]) {
    const [projects, sensors] = await Promise.all([db.collection("projects").get(), db.collection("work-sensors").select("location.site", "type").get()]);
    const counts = new Map<string, number>();
    sensors.forEach((s) => {
      const site = s.get("location.site");
      if (site) counts.set(site, (counts.get(site) ?? 0) + 1);
    });
    projects.docs
      .map((p) => ({ id: p.id, name: projectName(p.data()), n: counts.get(p.id) ?? 0 }))
      .sort((a, b) => b.n - a.n)
      .forEach((p) => console.log(`${String(p.n).padStart(4)}  ${p.id}  ${p.name}`));
    return;
  }

  const project = await resolveProject(args._[0]);
  const sensors = await projectSensors(project.id, str(args.type));
  const staleBefore = parseWhen(str(args.stale) ?? "24h", 0);
  console.log(`\n● ${project.name} (${project.id}) — ${sensors.length} sensors${args.type ? ` of type ${args.type}` : ""}\n`);

  const rows = await Promise.all(
    sensors.map(async (s) => {
      const snap = await db.collection(`work-sensors/${s.id}/data-log`).orderBy("time", "desc").limit(10).get();
      const raw = snap.docs.find((d) => !d.id.startsWith("daily::"));
      return { s, last: raw ? toMs(raw.data().time) : null };
    }),
  );
  rows.forEach(({ s, last }) => {
    const flag = last === null ? "⚫" : last < staleBefore ? "🔴" : "🟢";
    console.log(`${flag} ${String(s.label).padEnd(24)} ${String(s.data.type ?? "").padEnd(14)} ${s.id}  last: ${fmtTime(last)}`);
  });
  const silent = rows.filter((r) => r.last === null || r.last < staleBefore).length;
  console.log(`\n${silent} of ${rows.length} sensors silent since ${fmtTime(staleBefore)}\n`);
});
