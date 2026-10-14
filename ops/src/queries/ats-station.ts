/**
 * ATS station overview (read-only): ats-station-health/{gateway} (latest + cycle history + events),
 * ats-station-state, data-integrity notices for the station, and recent alerts of its project.
 * Usage: npx tsx src/queries/ats-station.ts --gateway=ATS-5 [--since=3d|YYYY-MM-DD] [--cycles=30]
 */
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, parseWhen, run, str } from "../lib/cli";

const ms = (v: any): number | undefined =>
  v == null ? undefined : typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : v.toMillis ? v.toMillis() : undefined;

run(async () => {
  const args = parseArgs();
  const gw = str(args.gateway) ?? "ATS-5";
  const since = parseWhen(str(args.since), Date.now() - 3 * 864e5);
  const station = db.collection("ats-station-health").doc(gw);

  const doc = await station.get();
  if (!doc.exists) {
    console.log(`\nNo ats-station-health/${gw}\n`);
  } else {
    const d = doc.data()!;
    console.log(`\n== ats-station-health/${gw}`);
    console.log(`  lastSeenAt (last ats-health): ${fmtTime(ms(d.lastSeenAt))}   lastCycleId: ${d.lastCycleId}   lastHealthStatus: ${d.lastHealthStatus}`);
    console.log(`  lastStatusAt (heartbeat):     ${fmtTime(ms(d.lastStatusAt))}   stationSilent: ${d.stationSilent}`);
    if (d.lastStatus) console.log(`  lastStatus: ${JSON.stringify(d.lastStatus)}`);
    console.log(`  software: ${d.software ?? "?"}   site: ${d.siteId}`);
    const c = d.cycle || {};
    console.log(`  latest cycle #${c.id} ${c.status} quality=${c.quality} held=${c.held} published=${c.published}  finished ${fmtTime(ms(c.finishedAt))}`);
    for (const f of c.flags || []) console.log(`     flag ${f.level} ${f.flag}: ${f.message}`);
    const r = d.resection || {};
    console.log(`  resection: RMS ${r.rmsMm} mm, used ${JSON.stringify(r.refsUsed)}, failed ${JSON.stringify((r.refsFailed || []).map((x: any) => x.id))}, residuals ${JSON.stringify(r.residualsMm)}`);
    for (const ch of d.health?.checks || []) if (ch.status !== "ok") console.log(`     health ${ch.status} ${ch.check}: ${ch.message}`);
    for (const rec of d.recommendations || []) console.log(`     rec [${rec.severity}] ${rec.title} (since ${rec.sinceCycle}, ${rec.nCycles} cycles)`);
  }

  const cyc = await station.collection("cycles").orderBy("cycle.finishedAt", "desc").limit(num(args.cycles, 30)).get();
  console.log(`\n== cycles (newest first, ${cyc.size})`);
  for (const x of cyc.docs) {
    const d = x.data();
    const c = d.cycle || {};
    if ((ms(c.finishedAt) ?? 0) < since) continue;
    const bad = (c.flags || []).filter((f: any) => f.level === "bad").map((f: any) => f.flag).join(",");
    const hc = (d.health?.checks || []).filter((h: any) => h.status !== "ok").map((h: any) => h.check).join(",");
    console.log(`  #${c.id} ${fmtTime(ms(c.finishedAt))} ${String(c.status).padEnd(9)} q=${String(c.quality).padEnd(7)} rms=${d.resection?.rmsMm ?? "-"} refs=${(d.resection?.refsUsed || []).length} pub=${c.published ?? "-"} counts=${JSON.stringify(d.counts || {})}  ${bad ? "HELD:" + bad : ""}  health:${hc}  sw=${d.software ?? "?"}`);
  }

  const ev = await station.collection("events").get();
  const evs = ev.docs.map((e) => e.data()).filter((e) => ms(e.timestamp)! >= since).sort((a, b) => b.timestamp - a.timestamp);
  console.log(`\n== events since ${fmtTime(since)} (${evs.length})`);
  for (const e of evs) console.log(`  ${fmtTime(ms(e.timestamp))} ${e.type} status=${e.status} ${e.pointId ?? ""} ${JSON.stringify((e.points || []).map((p: any) => p.id))}`);

  const st = await db.collection("ats-station-state").doc(gw).get();
  if (st.exists) console.log(`\n== ats-station-state/${gw}: ${JSON.stringify(st.data())}`);

  const notices = await db.collection("data-integrity").where("sensorId", "==", gw).get();
  const ns = notices.docs.map((n) => ({ id: n.id, ...n.data() }) as any)
    .filter((n) => n.status === "open" || (ms(n.updatedAt ?? n.createdAt) ?? 0) >= since);
  console.log(`\n== data-integrity notices for ${gw} (open or recent: ${ns.length})`);
  for (const n of ns) console.log(`  ${n.status} ${n.kind} ${fmtTime(ms(n.createdAt))}→${fmtTime(ms(n.updatedAt))}  ${String(n.title ?? n.message ?? "").slice(0, 140)}`);

  const projectId = ns.find((n) => n.projectId)?.projectId;
  if (projectId) {
    const al = await db.collection("alerts").where("time", ">=", since).orderBy("time", "desc").limit(1000).get();
    const rows = al.docs.map((a) => a.data()).filter((a: any) => a.location?.site === projectId);
    const bySensor = new Map<string, number>();
    rows.forEach((a: any) => bySensor.set(`${a.sensor ?? a.sensorDocId} ${a.axis ?? ""} →${a.new_level ?? a.severity}`, (bySensor.get(`${a.sensor ?? a.sensorDocId} ${a.axis ?? ""} →${a.new_level ?? a.severity}`) ?? 0) + 1));
    console.log(`\n== threshold alerts in project ${projectId} since ${fmtTime(since)}: ${rows.length}`);
    [...bySensor].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
  }
  console.log();
});
