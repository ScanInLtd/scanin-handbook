/**
 * Recent threshold alerts (alerts/{id}, created by checkThresholds, delivered by handleAlerts).
 * Usage: npx tsx src/queries/alerts.ts [--since=1d|YYYY-MM-DD] [--sensor=<docId>] [--project=<id|name>] [--limit=200]
 *
 * Delivery (WhatsApp/email) results are in Cloud Logging, not Firestore — see ./go.sh → "Function logs".
 */
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, parseWhen, run, str } from "../lib/cli";
import { resolveProject } from "../lib/sensors";

run(async () => {
  const args = parseArgs();
  const since = parseWhen(str(args.since), Date.now() - 864e5);
  const snap = await db.collection("alerts").where("time", ">=", since).orderBy("time", "desc").limit(num(args.limit, 200)).get();

  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>);
  if (args.sensor) rows = rows.filter((r) => r.sensorDocId === args.sensor || r.sensor === args.sensor);
  if (args.project) {
    const p = await resolveProject(str(args.project)!);
    rows = rows.filter((r) => r.location?.site === p.id);
  }

  console.log(`\n${rows.length} alerts since ${fmtTime(since)}\n`);
  const bySite = new Map<string, number>();
  rows.forEach((r) => {
    const icon = r.severity === "alarm" ? "🔴" : r.severity === "warn" ? "🟡" : "⚪";
    console.log(`${icon} ${fmtTime(r.time)}  ${r.siteName ?? "?"} / ${r.sectionName ?? "?"}  sensor=${r.sensor ?? "?"} (${r.sensorDocId ?? "?"})  ${r.axis ?? ""}  ${r.prev_level ?? ""}→${r.new_level ?? r.severity ?? ""}  value=${r.actualValue ?? ""}  [${r.type}]`);
    bySite.set(r.siteName ?? "?", (bySite.get(r.siteName ?? "?") ?? 0) + 1);
  });
  if (rows.length) {
    console.log("\nBy site:");
    [...bySite].sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`  ${String(n).padStart(4)}  ${s}`));
  }
  console.log();
});
