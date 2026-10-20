/**
 * Read-only: build a self-contained HTML page for reviewing level jumps, one at a time (Hebrew, RTL).
 * The reviewer (Nathan) clicks "real movement / iron it / not sure" per jump; answers stay in the
 * browser (localStorage) and are exported with one click (copy text + JSON) to send back.
 * No server, no login: open the file anywhere, incl. a phone.
 *
 * Input JSON: { title, items: [{ sensorId, time: "YYYY-MM-DD[THH:MM]", note? }] }
 * Usage: npx tsx src/review/jump-review.ts --input=review/jumps-2026-10-20.json [--days=30] [--out=out/jump-review.html]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../lib/firebase";
import { num, parseArgs, run, str } from "../lib/cli";
import { projectName, sensorLabel } from "../lib/sensors";
import { DAY, median } from "../lib/signal";

const AXES = [
  { key: "EastingDisplacement", he: "תזוזה X" },
  { key: "NorthingDisplacement", he: "תזוזה Y" },
  { key: "HeightDisplacement", he: "תזוזה Z" },
];

run(async () => {
  const args = parseArgs();
  const inputPath = path.resolve(process.cwd(), str(args.input) ?? "");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const pad = num(args.days, 30) * DAY;
  const projects = new Map((await db.collection("projects").get()).docs.map((d) => [d.id, projectName(d.data())]));

  const cache = new Map<string, any>();
  const items: any[] = [];
  for (const [i, it] of (input.items as any[]).entries()) {
    const t = Date.parse(it.time.length === 10 ? `${it.time}T00:00:00Z` : it.time);
    const from = t - pad;
    const to = Math.min(Date.now(), t + pad);
    if (!cache.has(it.sensorId)) {
      const s = await db.collection("work-sensors").doc(it.sensorId).get();
      const ev = await db.collection(`work-sensors/${it.sensorId}/baseline-events`).orderBy("time").get();
      cache.set(it.sensorId, { s: s.data(), events: ev.docs.map((d) => d.data()).filter((e) => typeof e.time === "number") });
    }
    const { s, events } = cache.get(it.sensorId);
    if (!s) { console.warn(`! ${it.sensorId}: sensor not found, skipped`); continue; }
    const snap = await db.collection(`work-sensors/${it.sensorId}/data-log`).where("time", ">=", from).where("time", "<=", to).orderBy("time").get();
    const init = s["initial-value"] ?? {};
    const baselineAt = (time: number) => {
      let found: any = null;
      for (const e of events) if (e.time <= time) found = e;
      return found?.initial ?? init;
    };
    const series: Record<string, [number, number][]> = {};
    for (const d of snap.docs) {
      if (d.id.startsWith("daily::")) continue;
      const x = d.data();
      if (typeof x.time !== "number") continue;
      const b = baselineAt(x.time);
      for (const a of AXES) {
        const v = parseFloat(x[a.key]);
        if (Number.isFinite(v)) (series[a.key] ??= []).push([x.time, Math.round((v - (Number(b[a.key]) || 0)) * 10) / 10]);
      }
    }
    // thin to ≤ 300 points per axis (keeps every n-th + extremes are rare enough here)
    for (const k of Object.keys(series)) {
      const arr = series[k];
      if (arr.length > 300) {
        const step = Math.ceil(arr.length / 300);
        series[k] = arr.filter((_, j) => j % step === 0 || j === arr.length - 1);
      }
    }
    const jumps: Record<string, number> = {};
    for (const a of AXES) {
      const arr = series[a.key] ?? [];
      const before = arr.filter(([tt]) => tt < t && tt >= t - 3 * DAY).map(([, v]) => v);
      const after = arr.filter(([tt]) => tt >= t && tt < t + 3 * DAY).map(([, v]) => v);
      if (before.length && after.length) jumps[a.key] = Math.round((median(after) - median(before)) * 10) / 10;
    }
    items.push({
      idx: i, sensorId: it.sensorId, time: t, note: it.note ?? "",
      name: sensorLabel(s, it.sensorId), project: projects.get(s.location?.site) ?? s.location?.site ?? "?",
      type: s.type, from, to, series, jumps,
      events: events.filter((e: any) => e.time >= from && e.time <= to).map((e: any) => ({ time: e.time, reason: e.reason })),
      uiLink: `https://new-scanin-ui.web.app/s/${it.sensorId}`,
    });
    console.log(`✓ ${i + 1}/${input.items.length} ${sensorLabel(s, it.sensorId)} ${it.time} (${snap.size} docs)`);
  }

  const outPath = path.resolve(process.cwd(), str(args.out) ?? `out/jump-review-${new Date().toISOString().slice(0, 10)}.html`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, page(input.title ?? "קפיצות לאישור", items));
  console.log(`\n📄 ${outPath}`);
});

function page(title: string, items: any[]): string {
  const data = JSON.stringify({ title, items, axes: AXES, key: `jump-review:${title}` });
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
*{box-sizing:border-box} body{margin:0;font:15px/1.4 -apple-system,Segoe UI,Arial,sans-serif;background:#f4f5f7;color:#1f2328}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e3e5e8;padding:10px 14px;display:flex;gap:12px;align-items:center;z-index:2}
header h1{font-size:16px;margin:0;flex:1} .prog{height:6px;background:#e9ecef;border-radius:3px;overflow:hidden;width:160px}
.prog>i{display:block;height:100%;background:#2e9e4f}
main{max-width:860px;margin:14px auto;padding:0 12px}
.card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:14px}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}
.name{font-size:22px;font-weight:700} .proj{color:#57606a} .when{font-weight:600}
.note{background:#fff8c5;border-radius:8px;padding:6px 10px;margin:8px 0;display:inline-block}
.jumps{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0} .jumps span{background:#f0f2f5;border-radius:6px;padding:2px 8px;direction:ltr}
.chart{margin:6px 0 2px} .chart h3{font-size:13px;margin:6px 0 2px;color:#57606a;font-weight:600}
svg{width:100%;height:120px;background:#fbfbfc;border-radius:8px;direction:ltr}
.btns{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:12px}
.btns button{font-size:17px;padding:14px 8px;border-radius:10px;border:2px solid transparent;cursor:pointer;font-weight:700}
.b-iron{background:#e8f1ff;color:#0b4fb3} .b-real{background:#ffeceb;color:#b42318} .b-unsure{background:#f0f2f5;color:#57606a}
.btns button.sel{border-color:#1f2328}
.nav{display:flex;justify-content:space-between;margin-top:10px;gap:8px} .nav button,.nav a{background:none;border:1px solid #d0d7de;border-radius:8px;padding:6px 12px;cursor:pointer;color:#1f2328;text-decoration:none;font-size:14px}
textarea{width:100%;margin-top:8px;border-radius:8px;border:1px solid #d0d7de;padding:6px;font:inherit;min-height:38px}
.hint{color:#8c959f;font-size:12px;text-align:center;margin-top:6px}
.list{margin-top:14px;display:flex;flex-wrap:wrap;gap:6px} .list button{border:1px solid #d0d7de;background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}
.list button.d-iron{background:#e8f1ff}.list button.d-real{background:#ffeceb}.list button.d-unsure{background:#f0f2f5}.list button.cur{outline:2px solid #1f2328}
.done{text-align:center;padding:24px} .done button{font-size:17px;padding:12px 18px;border-radius:10px;border:0;background:#2e9e4f;color:#fff;font-weight:700;cursor:pointer}
pre{white-space:pre-wrap;background:#f6f8fa;border-radius:8px;padding:10px;text-align:right;font-size:13px}
</style></head><body>
<header><h1>${title}</h1><span id="count"></span><div class="prog"><i id="bar"></i></div></header>
<main><div id="card" class="card"></div><div id="list" class="list"></div></main>
<script>
const D=${data};
const S=JSON.parse(localStorage.getItem(D.key)||'{}');
let cur=Math.max(0,D.items.findIndex(it=>!S[it.idx]));if(cur<0)cur=D.items.length;
const LBL={iron:'לגהץ – קפיצה מדומה',real:'תזוזה אמיתית – להשאיר',unsure:'לא בטוח'};
const fmt=t=>new Date(t).toLocaleDateString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'2-digit'});
function save(){localStorage.setItem(D.key,JSON.stringify(S))}
function chart(it,ax){const pts=it.series[ax.key]||[];if(!pts.length)return '';
 const W=800,H=120,P=6;const vs=pts.map(p=>p[1]);let lo=Math.min(...vs),hi=Math.max(...vs);if(hi-lo<1){const m=(hi+lo)/2;lo=m-0.5;hi=m+0.5}
 const x=t=>P+(t-it.from)/(it.to-it.from)*(W-2*P),y=v=>H-P-(v-lo)/(hi-lo)*(H-2*P);
 const line=pts.map(p=>x(p[0]).toFixed(1)+','+y(p[1]).toFixed(1)).join(' ');
 const ev=it.events.map(e=>'<line x1="'+x(e.time)+'" x2="'+x(e.time)+'" y1="0" y2="'+H+'" stroke="#8250df" stroke-dasharray="4 3"/>').join('');
 const jx=x(it.time);
 return '<div class="chart"><h3>'+ax.he+' (מ״מ) · '+lo.toFixed(1)+' … '+hi.toFixed(1)+'</h3><svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+
 '<rect x="'+(jx-2)+'" y="0" width="4" height="'+H+'" fill="#f59f00" opacity=".55"/>'+ev+
 '<polyline fill="none" stroke="#1f6feb" stroke-width="1.6" points="'+line+'"/></svg></div>'}
function render(){const n=D.items.length,done=D.items.filter(it=>S[it.idx]).length;
 document.getElementById('count').textContent=done+' / '+n;document.getElementById('bar').style.width=(done/n*100)+'%';
 const c=document.getElementById('card');
 if(cur>=n){c.innerHTML='<div class="done"><h2>סיימת 🎉</h2><p>'+done+' מתוך '+n+' נבדקו.</p><button onclick="exportRes()">העתק תוצאות לשליחה</button><pre id="out"></pre></div>';renderList();return}
 const it=D.items[cur],a=S[it.idx]||{};
 const jumps=D.axes.filter(ax=>it.jumps[ax.key]!==undefined).map(ax=>'<span>'+ax.he+': '+(it.jumps[ax.key]>0?'+':'')+it.jumps[ax.key]+'</span>').join('');
 c.innerHTML='<div class="top"><div><div class="name">'+it.name+'</div><div class="proj">'+it.project+'</div></div><div class="when">קפיצה ב-'+fmt(it.time)+'</div></div>'+
 (it.note?'<div class="note">'+it.note+'</div>':'')+'<div class="jumps">'+jumps+'</div>'+
 D.axes.map(ax=>chart(it,ax)).join('')+
 '<div class="hint">כתום = מועד הקפיצה · סגול מקווקו = בייסליין קיים · '+fmt(it.from)+' – '+fmt(it.to)+'</div>'+
 '<div class="btns"><button class="b-iron '+(a.d==='iron'?'sel':'')+'" onclick="pick(\\'iron\\')">לגהץ<br><small>קפיצה מדומה</small></button>'+
 '<button class="b-real '+(a.d==='real'?'sel':'')+'" onclick="pick(\\'real\\')">אמיתי<br><small>להשאיר</small></button>'+
 '<button class="b-unsure '+(a.d==='unsure'?'sel':'')+'" onclick="pick(\\'unsure\\')">לא בטוח</button></div>'+
 '<textarea id="note" placeholder="הערה (לא חובה)" oninput="noteIt(this.value)">'+(a.n||'')+'</textarea>'+
 '<div class="nav"><button onclick="go(-1)">→ הקודם</button><a href="'+it.uiLink+'" target="_blank">פתח במערכת</a><button onclick="go(1)">הבא ←</button></div>'+
 '<div class="hint">מקלדת: 1 לגהץ · 2 אמיתי · 3 לא בטוח · חיצים לניווט</div>';
 renderList()}
function renderList(){document.getElementById('list').innerHTML=D.items.map((it,i)=>'<button class="'+(S[it.idx]?'d-'+S[it.idx].d:'')+(i===cur?' cur':'')+'" onclick="cur='+i+';render()">'+it.name+' '+fmt(it.time)+'</button>').join('')}
function pick(d){const it=D.items[cur];S[it.idx]={...(S[it.idx]||{}),d,at:new Date().toISOString()};save();cur=Math.min(D.items.length,cur+1);render()}
function noteIt(v){const it=D.items[cur];S[it.idx]={...(S[it.idx]||{}),n:v};save()}
function go(k){cur=Math.max(0,Math.min(D.items.length,cur+k));render()}
function exportRes(){const rows=D.items.map(it=>({sensorId:it.sensorId,name:it.name,project:it.project,time:new Date(it.time).toISOString().slice(0,16),decision:(S[it.idx]||{}).d||null,note:(S[it.idx]||{}).n||''}));
 const txt=D.title+'\\n'+rows.map(r=>'• '+r.name+' ('+r.project+') '+fmt(Date.parse(r.time))+': '+(r.decision?LBL[r.decision]:'—')+(r.note?' – '+r.note:'')).join('\\n')+'\\n\\nJSON:\\n'+JSON.stringify(rows);
 document.getElementById('out').textContent=txt;(navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject()).then(()=>alert('הועתק! הדבק בוואטסאפ'),()=>alert('סמן את הטקסט והעתק ידנית'))}
document.addEventListener('keydown',e=>{if(e.target.tagName==='TEXTAREA')return;if(e.key==='1')pick('iron');if(e.key==='2')pick('real');if(e.key==='3')pick('unsure');if(e.key==='ArrowLeft')go(1);if(e.key==='ArrowRight')go(-1)});
render();
</script></body></html>`;
}
