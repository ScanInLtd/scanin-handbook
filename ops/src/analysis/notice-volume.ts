/**
 * Read-only: how many messages hit people in the last N days — client alerts (alerts) and internal
 * notices (data-integrity) — by site, tier/kind and WhatsApp delivery.
 * Usage: npx tsx src/analysis/notice-volume.ts [--days=7]
 */
import { db } from "../lib/firebase";
import { num, parseArgs, run } from "../lib/cli";
import { projectName } from "../lib/sensors";

run(async () => {
  const args = parseArgs();
  const days = num(args.days, 7);
  const since = Date.now() - days * 864e5;
  const projects = new Map((await db.collection("projects").get()).docs.map((d) => [d.id, projectName(d.data())]));
  const count = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1));
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const print = (title: string, rows: [string, number][], top = 15) => {
    console.log(`\n${title}`);
    rows.slice(0, top).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));
  };

  const alerts = (await db.collection("alerts").where("time", ">=", since).get()).docs.map((d) => d.data());
  console.log(`\n━━ Client alerts (alerts), last ${days}d: ${alerts.length} (${(alerts.length / days).toFixed(1)}/day) ━━`);
  print("by site", count(alerts, (a: any) => projects.get(a.location?.site) ?? a.siteName ?? "?"));
  print("by tier/type", count(alerts, (a: any) => `${a.type}/${a.tier ?? a.subType ?? "-"}${a.internalOnly ? " (internal)" : ""}`));
  print("by WhatsApp state", count(alerts, (a: any) => (a.whatsapp ? `pending=${(a.whatsapp.pending ?? []).length > 0} sent=${(a.whatsapp.sent ?? []).length} failed=${(a.whatsapp.failed ?? []).length}` : "no whatsapp field")), 8);

  const snap = await db.collection("data-integrity").get();
  const di = snap.docs.map((d) => d.data()).filter((x: any) => {
    const t = x.createdAt?.toMillis?.() ?? x.createdAt ?? x.time ?? x.firstSeenAt?.toMillis?.() ?? x.lastSeenAt?.toMillis?.();
    return typeof t === "number" && t >= since;
  });
  console.log(`\n━━ Internal notices (data-integrity), last ${days}d: ${di.length} of ${snap.size} total ━━`);
  print("by site", count(di, (x: any) => projects.get(x.projectId ?? x.siteId ?? x.location?.site) ?? x.siteName ?? "?"));
  print("by kind", count(di, (x: any) => String(x.kind ?? x.type ?? x.reason ?? "?")));
  print("by status", count(di, (x: any) => String(x.status ?? x.state ?? "?")), 8);
  const sample = snap.docs[0]?.data();
  if (sample) console.log(`\n(sample data-integrity fields: ${Object.keys(sample).join(", ")})`);
});
