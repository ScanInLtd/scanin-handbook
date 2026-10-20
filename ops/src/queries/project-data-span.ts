/**
 * Read-only: every sensor of a project (active or not) with its data span — first / last sample and count.
 * Usage: npx tsx src/queries/project-data-span.ts <projectId|name> [--type=prism]
 */
import { db } from "../lib/firebase";
import { parseArgs, run, str } from "../lib/cli";
import { projectSensors, resolveProject } from "../lib/sensors";

run(async () => {
  const args = parseArgs();
  const project = await resolveProject(args._[0] ?? "");
  const sensors = await projectSensors(project.id, str(args.type));
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const rows: any[] = [];
  for (const s of sensors) {
    const col = db.collection(`work-sensors/${s.id}/data-log`);
    const [first, last, cnt] = await Promise.all([
      col.orderBy("time", "asc").limit(1).get(), col.orderBy("time", "desc").limit(1).get(), col.count().get(),
    ]);
    const f = first.docs[0]?.data().time, l = last.docs[0]?.data().time;
    rows.push({ name: String(s.label), id: s.id, active: s.data.active !== false, n: cnt.data().count, f, l });
  }
  rows.sort((a, b) => (a.f ?? 9e15) - (b.f ?? 9e15));
  console.log(`\n● ${project.name}: ${rows.length} sensors\n`);
  for (const r of rows) console.log(`${r.active ? "  " : "✗ "}${r.name.padEnd(22).slice(0, 22)} ${String(r.n).padStart(6)}  ${r.f ? day(r.f) : "—"} → ${r.l ? day(r.l) : "—"}  ${r.id}`);
});
