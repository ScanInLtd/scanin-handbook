/**
 * Read-only: one row per ATS PC point with a plain verdict.
 *
 *  PC side   — from the ATS PC event-log CSV: measured OK / failed / held-as-suspect per cycle
 *  DB side   — ats-device-map → target sensor (name, active, exists, shared with another point)
 *  Identity  — which named UI sensor has the SAME coordinates (≤ 5 cm) as this point's data
 *
 * Usage: npx tsx src/analysis/ats-points-report.ts <projectId> --log=<csv> [--station=5] [--site=DeVinci-1] [--md=<out.md>]
 */
import * as fs from "node:fs";
import { db } from "../lib/firebase";
import { parseArgs, run, str } from "../lib/cli";
import { projectSensors, resolveProject } from "../lib/sensors";
import { DAY, median } from "../lib/signal";

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length >= head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

type C = { e: number; n: number; u: number };
async function coords(sensorId: string, from: number): Promise<C | null> {
  const snap = await db.collection(`work-sensors/${sensorId}/data-log`).where("time", ">=", from).get();
  const p = snap.docs.map((d) => d.data()).filter((x) => [x.e, x.n, x.u].every(Number.isFinite) && x.suspect !== true);
  return p.length ? { e: median(p.map((x) => x.e)), n: median(p.map((x) => x.n)), u: median(p.map((x) => x.u)) } : null;
}
const dist = (a: C, b: C) => Math.hypot(a.e - b.e, a.n - b.n, a.u - b.u);
const isAuto = (name: string) => /^ATS\./.test(name);

run(async () => {
  const args = parseArgs();
  const project = await resolveProject(args._[0] ?? "");
  const logPath = str(args.log);
  if (!logPath) throw new Error("--log=<csv> required");
  const station = str(args.station) ?? "5";
  const site = str(args.site) ?? "DeVinci-1";

  // ---- PC log
  const rows = parseCsv(fs.readFileSync(logPath, "utf8")).sort((a, b) => a.time.localeCompare(b.time));
  const pc = new Map<string, { ok: number; failed: number; suspect: number }>();
  const perCycle: { id: string; start: string; states: Map<string, string> }[] = [];
  let cycles = 0;
  let inCycle = false;
  let curId = "";
  let curStart = "";
  const seenThisCycle = new Map<string, string>();
  const flush = (complete: boolean) => {
    if (complete) perCycle.push({ id: curId, start: curStart, states: new Map(seenThisCycle) });
    if (complete) seenThisCycle.forEach((st, p) => {
      const e = pc.get(p) ?? { ok: 0, failed: 0, suspect: 0 };
      if (st === "ok") e.ok++; else if (st === "suspect") e.suspect++; else e.failed++;
      pc.set(p, e);
    });
    seenThisCycle.clear();
  };
  for (const r of rows) {
    const m = r.message;
    let mm: RegExpMatchArray | null;
    if ((mm = m.match(/^Cycle (\d+) starting/))) { if (inCycle) flush(false); inCycle = true; curId = mm[1]; curStart = r.time; }
    else if (inCycle && /^Cycle \d+ ok/.test(m)) { flush(true); cycles++; inCycle = false; }
    else if (inCycle && (mm = m.match(/^monitored (\S+) measured OK/))) { if (seenThisCycle.get(mm[1]) !== "suspect") seenThisCycle.set(mm[1], "ok"); }
    else if (inCycle && (mm = m.match(/^monitored (\S+) result held as suspect/))) seenThisCycle.set(mm[1], "suspect");
    else if (inCycle && (mm = m.match(/^monitored (\S+) measurement failed/))) { if (!seenThisCycle.has(mm[1])) seenThisCycle.set(mm[1], "failed"); }
  }

  // ---- DB
  const sensors = await projectSensors(project.id, "prism");
  const byId = new Map(sensors.map((s) => [s.id, s]));
  const mapSnap = await db.collection("ats-device-map").where("atsSiteId", "==", site).get();
  const map = new Map(mapSnap.docs.map((d) => [d.id, d.data().sensorId as string]));
  const fedBy = new Map<string, string[]>();
  map.forEach((sid, dev) => fedBy.set(sid, [...(fedBy.get(sid) ?? []), dev]));

  const named = sensors.filter((s) => !isAuto(String(s.label)));
  const namedCoords = new Map<string, C | null>();
  await Promise.all(named.map(async (s) => namedCoords.set(s.id, await coords(s.id, Date.now() - 120 * DAY))));

  const points = [...new Set([...pc.keys(), ...[...map.keys()].map((d) => d.replace(`ATS-${station}-`, ""))])]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  type Row = { point: string; pcText: string; target: string; visible: string; belongs: string; verdict: string; order: number };
  const out: Row[] = [];
  await Promise.all(points.map(async (p) => {
    const st = pc.get(p) ?? { ok: 0, failed: 0, suspect: 0 };
    const sid = map.get(`ATS-${station}-${p}`);
    const s = sid ? byId.get(sid) : undefined;
    const exists = sid ? (s ? true : (await db.collection("work-sensors").doc(sid).get()).exists) : false;
    const name = s ? String(s.label) : sid ? "(deleted sensor)" : "(no mapping)";
    const shared = sid ? (fedBy.get(sid) ?? []).filter((d) => d !== `ATS-${station}-${p}`).map((d) => d.replace(`ATS-${station}-`, "")) : [];
    const hidden = !sid || !exists || !s || s.data.active === false;

    // identity by coordinates (skip if the target is shared — coordinates are mixed)
    let belongs = "—";
    if (sid && !shared.length) {
      const dc = await coords(sid, Date.now() - 2 * DAY);
      if (dc) {
        const best = named.map((n) => ({ n, c: namedCoords.get(n.id) })).filter((x) => x.c).map((x) => ({ ...x, d: dist(dc, x.c!) })).sort((a, b) => a.d - b.d)[0];
        belongs = best && best.d <= 0.05 ? String(best.n.label) : "no match";
      } else belongs = "no recent data";
    } else if (shared.length) belongs = "mixed (can't tell)";

    const pcText = `${st.ok}✔ ${st.failed}✗ ${st.suspect}S of ${cycles}`;
    let verdict: string;
    let order: number;
    if (st.ok === 0 && st.failed + st.suspect > 0) { verdict = st.failed >= st.suspect ? "❌ ATS can't measure it" : "⚠️ ATS holds it as suspect"; order = 1; }
    else if (st.ok + st.failed + st.suspect === 0) { verdict = "⚪ not in ATS program"; order = 5; }
    else if (!exists) { verdict = "👻 sent → deleted sensor (invisible)"; order = 2; }
    else if (shared.length) { verdict = `🔀 sent → sensor shared with ${shared.join(",")}`; order = 2; }
    else if (hidden) { verdict = "👻 sent → hidden (inactive) sensor"; order = 2; }
    else if (belongs !== "—" && belongs !== "no match" && belongs !== "no recent data" && belongs !== name) { verdict = `🔀 sent → ${name}, but coordinates are ${belongs}'s`; order = 3; }
    else if (st.ok < cycles * 0.75) { verdict = "🟡 OK but often fails/suspect"; order = 4; }
    else { verdict = "✅ OK"; order = 6; }
    const visible = hidden ? "no" : "yes";
    out.push({ point: p, pcText, target: `${name}${shared.length ? " (shared)" : ""}${s?.data.active === false ? " [inactive]" : ""}`, visible, belongs, verdict, order });
  }));

  // named sensors no point writes into
  const fedNamed = new Set([...map.values()]);
  const orphanNamed = named.filter((s) => !fedNamed.has(s.id) && s.data.active !== false).map((s) => String(s.label))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  out.sort((a, b) => a.point.localeCompare(b.point, undefined, { numeric: true }));
  const header = `| ATS point | ATS PC (last ${cycles} cycles) | Data goes to UI sensor | Visible in UI | Coordinates belong to | Verdict |\n|---|---|---|---|---|---|`;
  const table = [header, ...out.map((r) => `| ${r.point} | ${r.pcText} | ${r.target} | ${r.visible} | ${r.belongs} | ${r.verdict} |`)].join("\n");
  const summary = Object.entries(out.reduce((acc, r) => ({ ...acc, [r.verdict.replace(/ →.*| with.*|, but.*/, "")]: (acc[r.verdict.replace(/ →.*| with.*|, but.*/, "")] ?? 0) + 1 }), {} as Record<string, number>))
    .map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const md = `# ${project.name} — ATS points (station ${station}, ${site})\n\nATS PC log: ${rows[0]?.time} → ${rows[rows.length - 1]?.time} (${cycles} cycles). ✔ measured OK · ✗ failed · S held as suspect (not sent)\n\n${table}\n\n**Summary**\n${summary}\n\n**UI sensors no ATS point writes into** (stay empty): ${orphanNamed.join(", ") || "—"}\n`;
  console.log(md);
  if (args.md) { fs.writeFileSync(String(args.md), md); console.log(`📄 ${args.md}`); }

  if (args.html) {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const il = (iso: string) => new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const dot = (st: string | undefined, cyc: string) => {
      const c = st === "ok" ? "ok" : st === "failed" ? "fail" : st === "suspect" ? "susp" : "none";
      const t = { ok: "measured & sent", fail: "measurement failed – nothing sent", susp: "held as suspect – not sent", none: "not attempted" }[c];
      return `<i class="${c}" title="${cyc}: ${t}"></i>`;
    };
    const cls = (o: number) => ["", "bad", "hidden", "mixed", "flaky", "na", "ok"][o];
    const short: Record<number, string> = { 1: "ATS doesn't measure", 2: "Sent → hidden", 3: "Wrong prism", 4: "Flaky", 5: "Not in ATS", 6: "OK" };
    const icons: Record<number, string> = { 1: "❌", 2: "👻", 3: "🔀", 4: "🟡", 5: "⚪", 6: "✅" };
    const body = out.map((r) => {
      const strip = perCycle.map((c) => dot(c.states.get(r.point), `${il(c.start)} (cycle ${c.id})`)).join("");
      const uiName = r.target.replace(/ \(shared\)| \[inactive\]/g, "");
      const tag = r.target.includes("(shared)") ? `<span class="tag">shared</span>`
        : r.target.includes("[inactive]") ? `<span class="tag">hidden</span>`
        : uiName.startsWith("(") ? `<span class="tag">deleted</span>` : "";
      const known = !/^(—|no match|no recent data|mixed.*)$/.test(r.belongs);
      const should = !known ? `<span class="muted">${r.belongs === "—" || r.belongs === "no recent data" ? "" : "?"}</span>` : r.belongs === uiName ? `<span class="same">=</span>` : `<b class="diff">${esc(r.belongs)}</b>`;
      const verdict = r.verdict.includes("shared") ? "Shared sensor" : r.verdict.includes("deleted") ? "Sent → deleted" : short[r.order];
      return `<tr class="${cls(r.order)}"><td class="n ats">${esc(r.point)}</td><td class="arr">→</td><td class="n ui${r.visible === "no" ? " gone" : ""}">${esc(uiName)}${tag}</td><td class="n">${should}</td><td class="strip">${strip}</td><td class="v">${icons[r.order]} ${verdict}</td></tr>`;
    }).join("\n");
    const counts = out.reduce((acc, r) => ((acc[r.order] = (acc[r.order] ?? 0) + 1), acc), {} as Record<number, number>);
    const chips = [6, 4, 1, 2, 3].map((o) => `<span class="chip ${cls(o)}">${icons[o]} ${short[o]} <b>${counts[o] ?? 0}</b></span>`).join("");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(project.name)} — ATS points</title>
<style>
body{font:13px/1.35 -apple-system,Segoe UI,Arial,sans-serif;margin:20px auto;max-width:720px;color:#222;padding:0 12px}
h1{font-size:17px;margin:0 0 2px} .sub{color:#777;font-size:12px;margin-bottom:10px}
.legend,.chips{margin:8px 0;display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px}
.chip{padding:2px 8px;border-radius:10px;background:#f2f2f2}
table{border-collapse:collapse;width:100%} th,td{padding:3px 6px;border-bottom:1px solid #eee;text-align:left;white-space:nowrap}
th{font-size:11px;color:#777;font-weight:600;background:#fafafa;position:sticky;top:0}
.n{font-family:ui-monospace,Menlo,monospace;font-weight:600}
.ats{color:#1a56db} .arr{color:#aaa;padding:3px 0;text-align:center}
.ui.gone{color:#999;text-decoration:line-through}
.tag{font:600 10px -apple-system,Arial;color:#fff;background:#9334e6;border-radius:6px;padding:0 5px;margin-left:5px;text-decoration:none;display:inline-block}
.same{color:#bbb} .diff{color:#c5221f} .muted{color:#bbb}
.strip{letter-spacing:0} i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:3px;vertical-align:middle}
i.ok{background:#34a853} i.fail{background:#ea4335} i.susp{background:#fb8c00} i.none{background:#ddd}
.v{font-size:12px}
tr.bad td{background:#fdecea} tr.hidden td{background:#f6effd} tr.mixed td{background:#fff4e5} tr.flaky td{background:#fffbe6}
.chip.bad{background:#fdecea}.chip.hidden{background:#f6effd}.chip.mixed{background:#fff4e5}.chip.flaky{background:#fffbe6}.chip.ok{background:#e6f4ea}
.foot{margin-top:10px;color:#555;font-size:12px}
</style></head><body>
<h1>${esc(project.name)} — ATS points</h1>
<div class="sub">station ${esc(station)} · ${esc(site)} · ATS log ${il(rows[0]?.time)} → ${il(rows[rows.length - 1]?.time)} · ${cycles} cycles</div>
<div class="legend"><span><i class="ok"></i>measured &amp; sent</span><span><i class="fail"></i>failed (not sent)</span><span><i class="susp"></i>suspect (not sent)</span><span class="muted">· one dot per cycle, oldest → newest</span></div>
<div class="chips">${chips}</div>
<table><thead><tr><th>ATS</th><th></th><th>UI sensor (now)</th><th>Should be</th><th>Cycles</th><th>Verdict</th></tr></thead>
<tbody>${body}</tbody></table>
<div class="foot"><b>Should be</b>: the UI sensor with the same prism coordinates (≤ 5 cm) · <span class="same">=</span> correct · <b class="diff">red</b> = data goes to the wrong sensor · <span class="tag">hidden</span> inactive auto-created sensor, not shown in UI</div>
<div class="foot"><b>UI sensors no ATS point writes into:</b> ${esc(orphanNamed.join(", ") || "—")}</div>
</body></html>`;
    fs.writeFileSync(String(args.html), html);
    console.log(`📄 ${args.html}`);
  }
});
