/**
 * Read-only: report configs of a project and their recent GeneratedReports (status, errors, email).
 * Usage: npx tsx src/queries/report-status.ts <projectId|name> [--n=5]
 */
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, run } from "../lib/cli";
import { resolveProject } from "../lib/sensors";

run(async () => {
  const args = parseArgs();
  const project = await resolveProject(args._[0] ?? "");
  const n = num(args.n, 5);
  const cfgSnap = await db.collection("ReportConfig").get();
  const cfgs = cfgSnap.docs.filter((d) => {
    const x = d.data();
    return [x.projectId, x.siteId, x.project, x.site, x.config?.projectId].includes(project.id) || JSON.stringify(x).includes(project.id);
  });
  console.log(`\n● ${project.name} (${project.id}): ${cfgs.length} report configs\n`);
  for (const c of cfgs) {
    const x = c.data();
    const keys = ["name", "title", "active", "schedule", "status", "lastRun", "lastRunAt", "lastStatus", "nextRun", "signalVersion", "periodDays", "startDate", "endDate"];
    console.log(`ReportConfig/${c.id}`);
    keys.filter((k) => x[k] !== undefined).forEach((k) => console.log(`  ${k}: ${typeof x[k] === "object" ? JSON.stringify(x[k]) : x[k]}`));
    console.log(`  sensors: ${(x.sensorIds ?? x.sensors ?? []).length ?? "?"}  recipients: ${JSON.stringify(x.recipients?.emails?.map((e: any) => e.email ?? e) ?? x.emails ?? x.recipients ?? "—")}`);
    const gen = await db.collection("GeneratedReports").where("configId", "==", c.id).get().catch(() => null);
    const docs = (gen?.docs ?? []).map((d) => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => String(b.createdAt?.toMillis?.() ?? b.createdAt ?? b.generatedAt ?? "").localeCompare(String(a.createdAt?.toMillis?.() ?? a.createdAt ?? a.generatedAt ?? "")))
      .slice(0, n);
    if (!docs.length) console.log("  (no GeneratedReports found by configId)");
    docs.forEach((g) => {
      const fields = Object.entries(g).filter(([k]) => /status|error|email|sent|progress|created|generated|finished|period|url|cancel|stage/i.test(k))
        .map(([k, v]) => `${k}=${typeof v === "object" && v && "toMillis" in (v as any) ? fmtTime(v) : JSON.stringify(v)?.slice(0, 120)}`);
      console.log(`  - GeneratedReports/${g.id}  ${fields.join("  ")}`);
    });
    console.log();
  }
});
