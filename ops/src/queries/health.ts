/**
 * System health overview: every heartbeat, latest watchdog checks, open incidents, maintenance windows.
 * Usage: npx tsx src/queries/health.ts [--all-incidents]
 *
 * Paths match scanin-svc-watchdog/src/constants.ts (COLLECTIONS).
 */
import { db } from "../lib/firebase";
import { fmtTime, parseArgs, run, toMs } from "../lib/cli";

const SKIP = new Set(["schemaVersion", "serviceName", "lastSeenAt", "status", "version", "host"]);

run(async () => {
  const args = parseArgs();

  console.log("\n━━ Heartbeats (system-heartbeats) ━━");
  const hb = await db.collection("system-heartbeats").get();
  for (const d of hb.docs) {
    const h = d.data();
    console.log(`\n● ${d.id}  status=${h.status ?? h.lastRunStatus ?? "?"}  v${h.version ?? "?"}  host=${h.host ?? "?"}`);
    console.log(`  lastSeenAt: ${fmtTime(h.lastSeenAt)}`);
    const extras = Object.entries(h)
      .filter(([k]) => !SKIP.has(k))
      .map(([k, v]) => `${k}=${toMs(v) && /At$/.test(k) ? fmtTime(v) : typeof v === "object" ? JSON.stringify(v) : v}`);
    if (extras.length) console.log(`  ${extras.join("\n  ")}`);
  }

  console.log("\n━━ Watchdog checks (system-checks) ━━");
  const checks = await db.collection("system-checks").get();
  const order = { critical: 0, warning: 1, ok: 2 } as Record<string, number>;
  checks.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>)
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
    .forEach((c) => {
      const icon = c.status === "ok" ? "🟢" : c.status === "warning" ? "🟡" : "🔴";
      console.log(`${icon} ${c.id.padEnd(32)} ${String(c.status).padEnd(8)} ${fmtTime(c.observedAt)}  ${c.message ?? ""}`);
    });

  console.log("\n━━ Incidents (system-incidents) ━━");
  let iq = db.collection("system-incidents").orderBy("openedAt", "desc").limit(args["all-incidents"] ? 50 : 20);
  const inc = await iq.get();
  const rows = inc.docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>);
  const shown = args["all-incidents"] ? rows : rows.filter((r) => r.status === "open");
  if (!shown.length) console.log("  (no open incidents)");
  shown.forEach((r) =>
    console.log(`  ${r.status === "open" ? "🔴" : "✔"} ${r.component} [${r.severity}] opened ${fmtTime(r.openedAt)}  alerts=${r.alertCount ?? 0}\n     ${r.latestMessage ?? ""}`),
  );

  console.log("\n━━ Maintenance windows (system-maintenance) ━━");
  const m = await db.collection("system-maintenance").get();
  const active = m.docs.filter((d) => d.data().enabled);
  if (!active.length) console.log("  (none active)");
  active.forEach((d) => console.log(`  🔧 ${d.id} until ${fmtTime(d.data().until)} — ${d.data().reason ?? ""}`));
  console.log();
});
