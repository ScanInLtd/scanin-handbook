/**
 * Event logs sent by ATS stations ("Send to support" on the station's Event Log tab).
 * They arrive as uplink/ats-log messages (gzip+base64 JSON lines, possibly in chunks); until the
 * bridge stores them separately they sit in ats_raw_payloads with messageType "ats-log".
 *
 * Usage:
 *   npx tsx src/queries/ats-log.ts [--gateway=ATS-5]                 list requests (newest first)
 *   npx tsx src/queries/ats-log.ts --gateway=ATS-5 --request=<id|latest> [--level=warn] [--grep=text] [--out=file.csv]
 */
import { writeFileSync } from "fs";
import { gunzipSync } from "zlib";
import { db } from "../lib/firebase";
import { fmtTime, parseArgs, run, str } from "../lib/cli";

const LEVELS: Record<string, number> = { DEBUG: 10, INFO: 20, WARNING: 30, WARN: 30, ERROR: 40, CRITICAL: 50 };

run(async () => {
  const args = parseArgs();
  const gw = str(args.gateway);
  let q: FirebaseFirestore.Query = db.collection("ats_raw_payloads").where("messageType", "==", "ats-log");
  if (gw) q = q.where("deviceId", "==", gw);
  const snap = await q.get();

  // requestId -> chunks
  const reqs = new Map<string, any[]>();
  for (const d of snap.docs) {
    const x = d.data();
    const p = x.payload || {};
    if (p.kind !== "ats-log") continue;
    const list = reqs.get(p.requestId) ?? [];
    list.push({ ...p, receivedAt: x.receivedAt?.toMillis?.() });
    reqs.set(p.requestId, list);
  }
  const ordered = [...reqs.entries()].sort((a, b) => (b[1][0].requestedAt ?? 0) - (a[1][0].requestedAt ?? 0));

  const want = str(args.request);
  if (!want) {
    console.log(`\n${ordered.length} log request(s)${gw ? ` from ${gw}` : ""}:\n`);
    for (const [id, parts] of ordered) {
      const p = parts[0];
      const got = new Set(parts.map((c) => c.chunk)).size;
      console.log(`  ${id}  ${p.deviceId} ${p.siteId}  sent ${fmtTime((p.requestedAt ?? 0) * 1000)}  ` +
        `window ${p.window?.minutes} min  ${p.nEvents} events  chunks ${got}/${p.chunks}  ${p.software ?? ""}`);
    }
    console.log(`\nShow one: --request=<id> (or --request=latest) [--level=warn] [--grep=text] [--out=file.csv]\n`);
    return;
  }
  const entry = want === "latest" ? ordered[0] : ordered.find(([id]) => id === want);
  if (!entry) throw new Error(`request ${want} not found`);
  const [id, parts] = entry;
  parts.sort((a, b) => a.chunk - b.chunk);
  const missing = parts[0].chunks - new Set(parts.map((c) => c.chunk)).size;
  let rows: any[] = [];
  for (const c of parts) {
    const text = gunzipSync(Buffer.from(c.data, "base64")).toString("utf8");
    rows.push(...text.split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  }
  const minLevel = LEVELS[(str(args.level) ?? "DEBUG").toUpperCase()] ?? 0;
  const grep = str(args.grep)?.toLowerCase();
  rows = rows.filter((r) => (LEVELS[r.level] ?? 20) >= minLevel && (!grep || String(r.message).toLowerCase().includes(grep)));

  const out = str(args.out);
  if (out) {
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    writeFileSync(out, ["id,time,level,source,message,details",
      ...rows.map((r) => [r.id, new Date(r.ts * 1000).toISOString(), r.level, r.source, r.message, r.details].map(esc).join(","))].join("\n"));
    console.log(`\nWrote ${rows.length} line(s) to ${out}${missing ? ` (WARNING: ${missing} chunk(s) not received yet)` : ""}\n`);
    return;
  }
  const p = parts[0];
  console.log(`\n== ${id}  ${p.deviceId} ${p.siteId}  window ${fmtTime(p.window.fromTs * 1000)} → ${fmtTime(p.window.toTs * 1000)}  ` +
    `${rows.length}/${p.nEvents} line(s)${missing ? `  (WARNING: ${missing} chunk(s) missing)` : ""}\n`);
  for (const r of rows) {
    console.log(`${new Date(r.ts * 1000).toISOString().slice(5, 19)} ${String(r.level).slice(0, 4)} ${String(r.source).padEnd(18).slice(0, 18)} ${r.message}`);
  }
  console.log();
});
