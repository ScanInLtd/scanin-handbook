/**
 * Internal data-integrity notices (data-integrity/{id}: implausible jumps, level shifts, late data,
 * bad ATS runs, unrouted points). Internal to ScanIn — never sent to clients.
 * Usage: npx tsx src/queries/integrity.ts [--all] [--since=7d|YYYY-MM-DD] [--kind=<kind>] [--sensor=<docId>] [--limit=200]
 *   default: open notices only; --all includes resolved ones (filtered by --since on lastSeenAt)
 */
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, parseWhen, run, str } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const snap = args.all
    ? await db.collection("data-integrity").where("lastSeenAt", ">=", new Date(parseWhen(str(args.since), Date.now() - 7 * 864e5))).orderBy("lastSeenAt", "desc").limit(num(args.limit, 200)).get()
    : await db.collection("data-integrity").where("status", "==", "open").limit(num(args.limit, 200)).get();

  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>);
  if (args.kind) rows = rows.filter((r) => r.kind === args.kind);
  if (args.sensor) rows = rows.filter((r) => r.sensorId === args.sensor);
  rows.sort((a, b) => (b.lastSeenAt?.toMillis?.() ?? 0) - (a.lastSeenAt?.toMillis?.() ?? 0));

  console.log(`\n${rows.length} ${args.all ? "" : "open "}data-integrity notices\n`);
  const byKind = new Map<string, number>();
  rows.forEach((r) => {
    const icon = r.status === "resolved" ? "✅" : r.severity === "critical" ? "🔴" : "🟡";
    console.log(`${icon} ${r.kind}  sensor=${r.sensorId ?? "-"}${r.axis ? ` ${r.axis}` : ""}  ×${r.count ?? 1}  opened ${fmtTime(r.openedAt)}  last ${fmtTime(r.lastSeenAt)}`);
    console.log(`     ${r.message ?? ""}${r.status === "resolved" ? `  → ${r.resolution} by ${r.resolvedBy ?? "?"}` : ""}`);
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  });
  if (rows.length) {
    console.log("\nBy kind:");
    [...byKind].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
  }
  console.log();
});
