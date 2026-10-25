/**
 * Read-only: a self-contained HTML page (Hebrew, RTL) for prisms that flip between two or more levels
 * (giant offsets, e.g. two prisms reporting into one sensor). Per prism: the levels found automatically,
 * each sample coloured by its level over the whole history (X / Y / Z), the periods of each level, which
 * one is near zero and which one is today. The reviewer (Nathan) picks per prism:
 *   level A / B / … is right · two different prisms → split · not sure, plus a free note.
 * Answers stay in the browser (localStorage) and are exported with one click (copy text + JSON).
 * No server, no login, no external fonts/libs: open the file anywhere, incl. a phone.
 *
 * Input JSON: { title, key, from, intro, items: [{ sensorId, context? }] }
 * Usage: npx tsx src/review/level-review.ts --input=review/level-decisions-2026-10-25.json [--out=review/level-review-2026-10-25.html]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../lib/firebase";
import { parseArgs, run, str } from "../lib/cli";
import { projectName } from "../lib/sensors";
import { DAY, median } from "../lib/signal";

const AXES = [
  { key: "EastingDisplacement", he: "מזרח (X)" },
  { key: "NorthingDisplacement", he: "צפון (Y)" },
  { key: "HeightDisplacement", he: "גובה (Z)" },
] as const;
const LEVEL_TH = 150; // mm: samples within this (max over axes) of a level's centre belong to it
const COLORS = ["#2563eb", "#ea580c", "#16a34a", "#9333ea", "#0891b2"];

type Pt = { t: number; v: number[]; suspect: boolean };

function clusterLevels(pts: Pt[]) {
  const levels: { c: number[]; n: number }[] = [];
  const label: number[] = [];
  for (const p of pts) {
    let best = -1, bestD = Infinity;
    levels.forEach((l, i) => {
      const d = Math.max(...p.v.map((x, k) => (Number.isFinite(x) ? Math.abs(x - l.c[k]) : 0)));
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0 && bestD <= LEVEL_TH) {
      const l = levels[best];
      l.n++;
      const w = 1 / Math.min(l.n, 50);
      l.c = l.c.map((c, k) => (Number.isFinite(p.v[k]) ? c + (p.v[k] - c) * w : c));
      label.push(best);
    } else {
      levels.push({ c: p.v.map((x) => (Number.isFinite(x) ? x : 0)), n: 1 });
      label.push(levels.length - 1);
    }
  }
  // small clusters → noise (-1); renumber the rest by first appearance
  const minN = Math.max(5, Math.round(pts.length * 0.01));
  const keep = levels.map((l) => l.n >= minN);
  const order: number[] = [];
  label.forEach((l) => { if (keep[l] && !order.includes(l)) order.push(l); });
  return label.map((l) => (keep[l] ? order.indexOf(l) : -1));
}

function periods(pts: Pt[], lab: number[]) {
  // run-length over the time-ordered labels (noise ignored); runs < 3 samples absorbed into neighbours
  const runs: { level: number; from: number; to: number; n: number }[] = [];
  pts.forEach((p, i) => {
    if (lab[i] < 0) return;
    const last = runs[runs.length - 1];
    if (last && last.level === lab[i]) { last.to = p.t; last.n++; }
    else runs.push({ level: lab[i], from: p.t, to: p.t, n: 1 });
  });
  const merged: typeof runs = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (r.n < 3 && last) { last.to = r.to; continue; }
    if (last && last.level === r.level) { last.to = r.to; last.n += r.n; } else merged.push({ ...r });
  }
  return merged;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fmtD = (t: number) => new Date(t).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit", timeZone: "Asia/Jerusalem" });
const fmtMm = (v: number) => {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(2)} מ'` : `${Math.round(a)} מ"מ`;
  return `${v < -0.5 ? "−" : v > 0.5 ? "+" : ""}${s}`;
};

function chartSvg(axis: number, pts: Pt[], lab: number[], runs: ReturnType<typeof periods>, tMin: number, tMax: number) {
  // daily median per level (keeps the file small); noise drawn grey
  const byDay = new Map<string, { t: number; l: number; v: number[] }>();
  const buckets = new Map<string, number[]>();
  pts.forEach((p, i) => {
    if (!Number.isFinite(p.v[axis])) return;
    const day = Math.floor(p.t / DAY);
    const k = `${day}:${lab[i]}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(p.v[axis]);
    if (!byDay.has(k)) byDay.set(k, { t: day * DAY + DAY / 2, l: lab[i], v: [] });
  });
  const dots = [...byDay.entries()].map(([k, d]) => ({ t: d.t, l: d.l, y: median(buckets.get(k)!) }));
  if (!dots.length) return `<div class="nodata">אין נתונים בציר הזה</div>`;
  let yMin = Math.min(0, ...dots.map((d) => d.y)), yMax = Math.max(0, ...dots.map((d) => d.y));
  const span = Math.max(yMax - yMin, 20);
  yMin -= span * 0.08; yMax += span * 0.08;
  const W = 1000, H = 150, L = 64, R = 12, T = 10, B = 24;
  const x = (t: number) => L + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const bands = runs.map((r) => `<rect x="${x(r.from).toFixed(1)}" y="${T}" width="${Math.max(1.5, x(r.to) - x(r.from)).toFixed(1)}" height="${H - T - B}" fill="${COLORS[r.level % COLORS.length]}" opacity="0.07"/>`).join("");
  const ticks: string[] = [];
  for (let i = 0; i <= 3; i++) {
    const v = yMin + ((yMax - yMin) * i) / 3;
    ticks.push(`<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" class="ty">${fmtMm(v)}</text>`);
  }
  const months: string[] = [];
  const d0 = new Date(tMin);
  for (let m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); m.getTime() < tMax; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const step = (tMax - tMin) / DAY > 400 ? 2 : 1;
    if (m.getUTCMonth() % step) continue;
    months.push(`<line x1="${x(m.getTime()).toFixed(1)}" x2="${x(m.getTime()).toFixed(1)}" y1="${T}" y2="${H - B}" class="vgrid"/><text x="${x(m.getTime()).toFixed(1)}" y="${H - 6}" class="tx">${m.getUTCMonth() + 1}/${String(m.getUTCFullYear()).slice(2)}</text>`);
  }
  const circles = dots.map((d) => `<circle cx="${x(d.t).toFixed(1)}" cy="${y(d.y).toFixed(1)}" r="2.4" fill="${d.l < 0 ? "#9ca3af" : COLORS[d.l % COLORS.length]}"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">${bands}${ticks.join("")}${months.join("")}<line x1="${L}" x2="${W - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="zero"/>${circles}</svg>`;
}

run(async () => {
  const args = parseArgs();
  const inputPath = path.resolve(process.cwd(), str(args.input) ?? "review/level-decisions-2026-10-25.json");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const from = Date.parse(`${input.from ?? "2025-01-01"}T00:00:00Z`);
  const projects = new Map((await db.collection("projects").get()).docs.map((d) => [d.id, projectName(d.data())]));

  const cards: string[] = [];
  const meta: any[] = [];
  for (const [idx, it] of (input.items as any[]).entries()) {
    const s = (await db.collection("work-sensors").doc(it.sensorId).get()).data()!;
    const events = (await db.collection(`work-sensors/${it.sensorId}/baseline-events`).orderBy("time").get()).docs
      .map((d) => d.data()).filter((e: any) => typeof e.time === "number");
    const init0 = s["initial-value"] ?? {};
    const inForce = (t: number) => {
      let f: any = null;
      for (const e of events) if (e.time <= t) f = e;
      return (f?.initial ?? init0) as Record<string, number>;
    };
    const snap = await db.collection(`work-sensors/${it.sensorId}/data-log`).where("time", ">=", from).orderBy("time").get();
    const pts: Pt[] = snap.docs.filter((d) => !d.id.startsWith("daily::")).map((d) => d.data())
      .filter((x) => typeof x.time === "number" && x.isReplay !== true && x.source !== "replay" && x.source !== "derived:daily")
      .map((x) => {
        const base = inForce(x.time);
        return { t: x.time as number, suspect: x.suspect === true, v: AXES.map((a) => parseFloat(x[a.key]) - (Number(base[a.key]) || 0)) };
      })
      .filter((p) => p.v.some(Number.isFinite));
    const lab = clusterLevels(pts);
    const runs = periods(pts, lab);
    const nLevels = Math.max(0, ...lab) + 1;
    const levels = Array.from({ length: nLevels }, (_, l) => {
      const mine = pts.filter((_, i) => lab[i] === l);
      const med = AXES.map((_, k) => median(mine.map((p) => p.v[k]).filter(Number.isFinite)));
      return { l, n: mine.length, med, nearZero: med.every((m) => !Number.isFinite(m) || Math.abs(m) < 60), runs: runs.filter((r) => r.level === l) };
    });
    const current = runs.length ? runs[runs.length - 1].level : -1;
    const tMin = pts[0]?.t ?? from, tMax = pts[pts.length - 1]?.t ?? Date.now();
    const name = s.name ?? it.sensorId;
    const project = projects.get(s.location?.site) ?? s.location?.site ?? "";
    const letter = (l: number) => String.fromCharCode(65 + l);
    meta.push({ id: it.sensorId, name, project, levels: levels.map((lv) => ({ letter: letter(lv.l), med: lv.med.map((m) => Math.round(m)) })) });

    const levelRows = levels.map((lv) => `
      <div class="lv" style="--c:${COLORS[lv.l % COLORS.length]}">
        <div class="lv-head"><span class="chip">רמה ${letter(lv.l)}</span>
          ${lv.l === current ? `<span class="tag now">הנתונים של היום</span>` : ""}
          ${lv.nearZero ? `<span class="tag zero">קרוב לאפס (קו הבסיס הנוכחי)</span>` : ""}
          <span class="lv-n">${lv.n.toLocaleString("he-IL")} מדידות</span></div>
        <div class="lv-vals">${AXES.map((a, k) => `<span><small>${a.he}</small><b>${fmtMm(lv.med[k])}</b></span>`).join("")}</div>
        <div class="lv-runs">${lv.runs.map((r) => `<span>${fmtD(r.from)} – ${fmtD(r.to)}</span>`).join("")}</div>
      </div>`).join("");

    const options = [
      ...levels.map((lv) => ({ v: `level-${letter(lv.l)}`, t: `רמה ${letter(lv.l)} נכונה`, d: lv.l === current ? "הנתונים של היום נשארים, האחרות מיושרות אליה" : "יישור כל השאר לרמה הזו" })),
      { v: "split", t: "שתי פריזמות שונות", d: "להפריד לשני חיישנים (לא ליישר)" },
      { v: "unsure", t: "לא בטוח", d: "נדבר / צריך לבדוק בשטח" },
    ];

    cards.push(`
    <section class="card" id="c${idx}" data-id="${esc(it.sensorId)}">
      <header class="card-head">
        <div><div class="proj">${esc(project)}</div><h2>פריזמה ${esc(name)}</h2></div>
        <div class="status" data-status>ממתין להחלטה</div>
      </header>
      ${it.context ? `<p class="context">${esc(it.context)}</p>` : ""}
      <div class="charts">${AXES.map((a, k) => `<div class="chart"><div class="ax">${a.he}</div>${chartSvg(k, pts, lab, runs, tMin, tMax)}</div>`).join("")}</div>
      <div class="legend">${levels.map((lv) => `<span style="--c:${COLORS[lv.l % COLORS.length]}"><i></i>רמה ${letter(lv.l)}</span>`).join("")}<span style="--c:#9ca3af"><i></i>מדידות בודדות</span><span class="zl"><i></i>אפס</span></div>
      <div class="levels">${levelRows}</div>
      <fieldset class="choices"><legend>מה ההחלטה?</legend>
        ${options.map((o) => `<label><input type="radio" name="q${idx}" value="${o.v}"><span><b>${esc(o.t)}</b><small>${esc(o.d)}</small></span></label>`).join("")}
      </fieldset>
      <textarea placeholder="הערה (לא חובה)" data-note></textarea>
    </section>`);
    console.log(`${project} "${name}": ${pts.length} samples, ${nLevels} levels, ${runs.length} periods, today = ${current >= 0 ? letter(current) : "—"}`);
  }

  const data = { key: input.key ?? "level-review", title: input.title, items: meta };
  const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(input.title)}</title>
<style>
:root{--bg:#f6f7fb;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#2563eb;--ok:#16a34a;--radius:18px}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Heebo","Arial Hebrew",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.top{position:sticky;top:0;z-index:5;background:rgba(246,247,251,.86);backdrop-filter:saturate(1.6) blur(12px);border-bottom:1px solid var(--line)}
.top-in{max-width:980px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:16px}
.top h1{font-size:17px;margin:0;font-weight:650;flex:1}
.progress{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px;white-space:nowrap}
.bar{width:120px;height:6px;border-radius:99px;background:var(--line);overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--ok);transition:width .3s}
.btn{appearance:none;border:0;border-radius:12px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer;background:var(--ink);color:#fff;transition:transform .1s,opacity .2s}
.btn:active{transform:scale(.97)}.btn.ghost{background:#fff;color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}
main{max-width:980px;margin:0 auto;padding:24px 20px 80px}
.intro{background:linear-gradient(135deg,#eef2ff,#f0f9ff);border:1px solid #dbeafe;border-radius:var(--radius);padding:18px 20px;margin-bottom:22px;color:#1e293b}
.intro b{font-weight:650}
.card{background:var(--card);border-radius:var(--radius);box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 28px rgba(15,23,42,.06);padding:22px 22px 18px;margin-bottom:22px;border:1px solid transparent;transition:border-color .2s}
.card.done{border-color:#bbf7d0}
.card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.proj{font-size:12px;letter-spacing:.02em;color:var(--muted);font-weight:600}
.card h2{margin:2px 0 0;font-size:22px;font-weight:700}
.status{font-size:12px;font-weight:600;padding:5px 11px;border-radius:99px;background:#fef3c7;color:#92400e;white-space:nowrap}
.card.done .status{background:#dcfce7;color:#166534}
.context{margin:12px 0 4px;color:#334155;font-size:14px}
.charts{margin-top:14px;display:grid;gap:6px}
.chart{position:relative;background:#fbfcfe;border:1px solid var(--line);border-radius:12px;padding:6px 8px 2px}
.chart svg{display:block;width:100%;height:120px}
.ax{position:absolute;top:6px;left:10px;font-size:11px;font-weight:600;color:var(--muted);background:rgba(251,252,254,.9);padding:0 4px;border-radius:6px}
.grid{stroke:#eef2f7;stroke-width:1}.vgrid{stroke:#f1f5f9;stroke-width:1}.zero{stroke:#94a3b8;stroke-width:1;stroke-dasharray:4 4}
.ty{font-size:11px;fill:#94a3b8;text-anchor:end;direction:ltr}.tx{font-size:11px;fill:#94a3b8;text-anchor:middle}
.nodata{color:var(--muted);font-size:13px;padding:18px;text-align:center}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin:10px 2px 4px;font-size:12px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:9px;height:9px;border-radius:50%;background:var(--c)}
.legend .zl i{width:16px;height:0;border-radius:0;border-top:1.5px dashed #94a3b8;background:none}
.levels{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:14px 0 16px}
.lv{border:1px solid var(--line);border-radius:14px;padding:12px 14px;position:relative;overflow:hidden}
.lv::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:var(--c)}
.lv-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.chip{font-weight:700;color:var(--c);font-size:15px}
.tag{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px}.tag.now{background:#e0e7ff;color:#3730a3}.tag.zero{background:#f1f5f9;color:#475569}
.lv-n{margin-inline-start:auto;font-size:12px;color:var(--muted)}
.lv-vals{display:flex;gap:16px;margin:8px 0 6px}.lv-vals span{display:flex;flex-direction:column}.lv-vals small{color:var(--muted);font-size:11px}.lv-vals b{font-size:15px;font-weight:650;direction:ltr;text-align:right}
.lv-runs{display:flex;flex-wrap:wrap;gap:6px}.lv-runs span{font-size:11.5px;background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:2px 7px;color:#334155}
.choices{border:0;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.choices legend{font-weight:650;margin-bottom:8px;font-size:14px}
.choices label{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:14px;padding:11px 12px;cursor:pointer;transition:border-color .15s,background .15s,box-shadow .15s}
.choices label:hover{border-color:#cbd5e1}
.choices input{margin-top:3px;accent-color:var(--accent)}
.choices label:has(input:checked){border-color:var(--accent);background:#eff6ff;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.choices b{display:block;font-weight:650;font-size:14px}.choices small{color:var(--muted);font-size:12px}
textarea{width:100%;margin-top:10px;min-height:44px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;resize:vertical;background:#fbfcfe}
textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.modal{position:fixed;inset:0;background:rgba(15,23,42,.45);display:none;align-items:center;justify-content:center;padding:20px;z-index:10}
.modal.open{display:flex}
.sheet{background:#fff;border-radius:20px;max-width:640px;width:100%;padding:22px;box-shadow:0 30px 80px rgba(15,23,42,.3)}
.sheet h3{margin:0 0 6px}.sheet p{margin:0 0 12px;color:var(--muted);font-size:14px}
.sheet pre{background:#f8fafc;border:1px solid var(--line);border-radius:12px;padding:12px;max-height:46vh;overflow:auto;white-space:pre-wrap;font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;direction:rtl;text-align:right}
.row{display:flex;gap:10px;justify-content:flex-start;margin-top:14px;flex-wrap:wrap}
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--ink);color:#fff;padding:10px 16px;border-radius:12px;font-size:14px;opacity:0;transition:.25s;pointer-events:none}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
@media (max-width:640px){.top-in{flex-wrap:wrap}.bar{width:80px}.card{padding:16px}.card h2{font-size:19px}.chart svg{height:96px}}
</style></head>
<body>
<div class="top"><div class="top-in">
  <h1>${esc(input.title)}</h1>
  <div class="progress"><span data-count>0 / ${meta.length}</span><div class="bar"><i data-bar></i></div></div>
  <button class="btn" data-export>שליחת התשובות</button>
</div></div>
<main>
  <div class="intro">${esc(input.intro ?? "")}<br><br><b>איך לקרוא:</b> כל נקודה היא חציון יומי. הצבע אומר לאיזו רמה המדידה שייכת, והפסים הבהירים ברקע מסמנים את התקופות של כל רמה. הקו המקווקו הוא אפס (קו הבסיס הנוכחי של החיישן). התשובות נשמרות בדפדפן; בסוף לוחצים "שליחת התשובות".</div>
  ${cards.join("\n")}
  <div class="row"><button class="btn" data-export>שליחת התשובות</button><button class="btn ghost" data-reset>ניקוי כל התשובות</button></div>
</main>
<div class="modal" data-modal><div class="sheet">
  <h3>התשובות שלך</h3><p>מעתיקים ושולחים להלל (וואטסאפ / מייל). אפשר גם להוריד קובץ.</p>
  <pre data-out></pre>
  <div class="row"><button class="btn" data-copy>העתקה</button><button class="btn ghost" data-json>הורדת קובץ</button><button class="btn ghost" data-close>סגירה</button></div>
</div></div>
<div class="toast" data-toast></div>
<script>
const D=${JSON.stringify(data)};
const S=JSON.parse(localStorage.getItem(D.key)||'{}');
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const LABEL={split:'שתי פריזמות שונות, להפריד',unsure:'לא בטוח'};
function save(){localStorage.setItem(D.key,JSON.stringify(S));refresh()}
function refresh(){let n=0;$$('.card').forEach(c=>{const a=S[c.dataset.id]||{};const done=!!a.choice;if(done)n++;c.classList.toggle('done',done);
  $('[data-status]',c).textContent=done?'✓ '+(LABEL[a.choice]||a.choice.replace('level-','רמה ')+' נכונה'):'ממתין להחלטה'});
  $('[data-count]').textContent=n+' / '+D.items.length;$('[data-bar]').style.width=(100*n/D.items.length)+'%'}
$$('.card').forEach(c=>{const id=c.dataset.id,a=S[id]||{};
  $$('input[type=radio]',c).forEach(r=>{if(r.value===a.choice)r.checked=true;r.addEventListener('change',()=>{S[id]={...S[id],choice:r.value};save()})});
  const t=$('[data-note]',c);t.value=a.note||'';t.addEventListener('input',()=>{S[id]={...S[id],note:t.value};save()})});
function summary(){return D.title+'\\n\\n'+D.items.map(it=>{const a=S[it.id]||{};const ch=a.choice?(LABEL[a.choice]||a.choice.replace('level-','רמה ')+' נכונה'):'— לא נענה';
  const lv=a.choice&&a.choice.startsWith('level-')?it.levels.find(l=>'level-'+l.letter===a.choice):null;
  return '• '+it.project+' / פריזמה '+it.name+': '+ch+(lv?' (X '+lv.med[0]+', Y '+lv.med[1]+', Z '+lv.med[2]+' מ"מ)':'')+(a.note?'\\n   הערה: '+a.note:'')}).join('\\n')}
function toast(m){const t=$('[data-toast]');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800)}
$$('[data-export]').forEach(b=>b.onclick=()=>{$('[data-out]').textContent=summary();$('[data-modal]').classList.add('open')});
$('[data-close]').onclick=()=>$('[data-modal]').classList.remove('open');
$('[data-modal]').onclick=e=>{if(e.target.matches('[data-modal]'))e.target.classList.remove('open')};
$('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(summary());toast('הועתק ✓')}catch{const r=document.createRange();r.selectNodeContents($('[data-out]'));getSelection().removeAllRanges();getSelection().addRange(r);toast('סמנו והעתיקו ידנית')}};
$('[data-json]').onclick=()=>{const blob=new Blob([JSON.stringify({key:D.key,exportedAt:new Date().toISOString(),answers:D.items.map(it=>({sensorId:it.id,name:it.name,project:it.project,...(S[it.id]||{})}))},null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=D.key+'-answers.json';a.click()};
$('[data-reset]').onclick=()=>{if(confirm('למחוק את כל התשובות?')){Object.keys(S).forEach(k=>delete S[k]);save();$$('input[type=radio]').forEach(r=>r.checked=false);$$('[data-note]').forEach(t=>t.value='')}};
refresh();
</script>
</body></html>`;

  const out = path.resolve(process.cwd(), str(args.out) ?? `review/${data.key}.html`);
  fs.writeFileSync(out, html);
  console.log(`📄 ${out} (${(html.length / 1024).toFixed(0)} KB)`);
});
