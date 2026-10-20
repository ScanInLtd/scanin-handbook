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
    // Per axis: level before / after (median over a week each side), and whether the readings after the
    // jump ALTERNATE between the two levels (two prisms mixed into one sensor) instead of stepping once.
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const jumps: Record<string, { before: number; after: number; jump: number; alternating: boolean; backShare: number }> = {};
    for (const a of AXES) {
      const arr = series[a.key] ?? [];
      const beforeVals = arr.filter(([tt]) => tt < t && tt >= t - 7 * DAY).map(([, v]) => v);
      const afterVals = arr.filter(([tt]) => tt >= t && tt < t + 7 * DAY).map(([, v]) => v);
      if (!beforeVals.length || !afterVals.length) continue;
      const before = median(beforeVals);
      // "after" level = median of the post-jump samples that are NOT near the old level (else alternation hides it)
      const tol = (x: number) => Math.max(10, Math.abs(x) / 4);
      const far = afterVals.filter((v) => Math.abs(v - before) > 10);
      const after = far.length >= afterVals.length * 0.2 ? median(far) : median(afterVals);
      const jump = after - before;
      const post = arr.filter(([tt]) => tt >= t).map(([, v]) => v);
      const nearOld = post.filter((v) => Math.abs(v - before) <= tol(jump)).length;
      const nearNew = post.filter((v) => Math.abs(v - after) <= tol(jump)).length;
      let switches = 0;
      let last: "o" | "n" | null = null;
      for (const v of post) {
        const c = Math.abs(v - before) <= tol(jump) ? "o" : Math.abs(v - after) <= tol(jump) ? "n" : null;
        if (c && last && c !== last) switches++;
        if (c) last = c;
      }
      let alternating = Math.abs(jump) > 10 && nearOld >= post.length * 0.15 && nearNew >= post.length * 0.15 && switches >= 6;
      let lvl = { before: r1(before), after: r1(after), jump: r1(jump) };
      // Window-wide check: two separate levels (largest gap in the sorted values) with readings switching
      // back and forth between them — catches alternation that started before the listed jump date.
      const all = arr.map(([, v]) => v);
      if (all.length >= 12) {
        const sorted = [...all].sort((p, q) => p - q);
        let gi = -1, gap = 0;
        for (let k = 1; k < sorted.length; k++) if (sorted[k] - sorted[k - 1] > gap) { gap = sorted[k] - sorted[k - 1]; gi = k; }
        const split = (sorted[gi - 1] + sorted[gi]) / 2;
        const lowN = gi, highN = sorted.length - gi;
        if (gap > 10 && lowN >= all.length * 0.15 && highN >= all.length * 0.15) {
          let sw = 0;
          for (let k = 1; k < all.length; k++) if ((all[k] > split) !== (all[k - 1] > split)) sw++;
          if (sw >= 6) {
            alternating = true;
            const low = median(sorted.slice(0, gi)), high = median(sorted.slice(gi));
            lvl = { before: r1(low), after: r1(high), jump: r1(high - low) };
          }
        }
      }
      jumps[a.key] = { ...lvl, alternating, backShare: post.length ? nearOld / post.length : 0 };
    }
    const main = AXES.filter((a) => jumps[a.key])
      .sort((p, q) => (Number(jumps[q.key].alternating) - Number(jumps[p.key].alternating)) || (Math.abs(jumps[q.key].jump) - Math.abs(jumps[p.key].jump)))[0];
    const dateHe = new Date(t).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit" });
    const fmtMm = (v: number) => `${v > 0 ? "+" : ""}${Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-US") : v}`;
    let summary = "אין מספיק נתונים סביב הקפיצה כדי למדוד אותה – ראה גרף";
    let kind = "unknown";
    if (main) {
      const j = jumps[main.key];
      if (j.alternating) {
        kind = "alternating";
        summary = `⚠️ המדידות ב${main.he} מתחלפות הלוך-חזור בין שתי רמות (${fmtMm(j.before)} ו-${fmtMm(j.after)}, פער ${fmtMm(j.jump)} מ״מ) – כנראה שתי פריזמות מעורבבות בחיישן אחד`;
      } else if (Math.abs(j.jump) < 3 && AXES.some((a) => Math.abs(median((series[a.key] ?? []).map(([, v]) => v))) > 50)) {
        kind = "offset";
        const offAx = AXES.map((a) => ({ a, off: median((series[a.key] ?? []).map(([, v]) => v)) })).sort((p, q) => Math.abs(q.off) - Math.abs(p.off))[0];
        const off = offAx.off;
        summary = `⚠️ כל התקופה המוצגת רחוקה מאפס: ${offAx.a.he} סביב ${fmtMm(r1(off))} מ״מ. הקפיצה עצמה קרתה לפני ${new Date(from).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit" })} – כנראה בייסליין/זיהוי פריזמה שגוי`;
      } else if (Math.abs(j.jump) < 3) {
        kind = "small";
        summary = `שינוי קטן ב-${dateHe}: ${main.he} ${fmtMm(j.jump)} מ״מ (פחות מ-3 מ״מ)`;
      } else {
        kind = "step";
        summary = `קפיצה חד-פעמית ב-${dateHe}: ${main.he} מ-${fmtMm(j.before)} ל-${fmtMm(j.after)} מ״מ (קפיצה של ${fmtMm(j.jump)} מ״מ)`;
      }
    }
    items.push({
      idx: i, sensorId: it.sensorId, time: t, note: it.note ?? "",
      name: sensorLabel(s, it.sensorId), project: projects.get(s.location?.site) ?? s.location?.site ?? "?",
      type: s.type, from, to, series, jumps, summary, kind,
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
svg{width:100%;height:120px;background:#fbfbfc;border-radius:8px;direction:ltr;display:block}
.pair{display:flex;gap:8px;direction:ltr} .pair .main{flex:3.3} .pair .mini{flex:1;position:relative}
.pair .mini svg{background:#f3f4f6} .pair .mini span{position:absolute;bottom:3px;left:6px;font-size:10px;color:#57606a;direction:ltr}
.summary{font-size:17px;font-weight:600;padding:10px 12px;border-radius:10px;margin:10px 0;background:#eef6ff;color:#0b4fb3}
.summary.alternating,.summary.offset{background:#fff1e5;color:#953800} .summary.small{background:#f0f2f5;color:#57606a} .summary.unknown{background:#f0f2f5;color:#57606a}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#57606a;margin:4px 0}
.legend i{display:inline-block;width:10px;height:10px;margin-left:4px;vertical-align:middle;border-radius:2px}
.lg-j{background:#f59f00;opacity:.6}.lg-b{border:2px dashed #8250df;width:8px!important;height:8px!important}.lg-r{background:#d1242f;border-radius:50%!important}
.chart h3 .ax{display:inline-block;background:#1f2328;color:#fff;border-radius:6px;padding:0 6px;margin-left:6px}
.chart h3 b.big{color:#b42318} .chart h3 b.alt{color:#953800}
.dates{position:relative;height:16px;font-size:11px;color:#57606a;direction:ltr}
.dates span{position:absolute;top:1px;white-space:nowrap} .dates span.j{transform:translateX(-50%);color:#b35c00;font-weight:700}
.sub{font-size:11px;color:#8c959f;margin-top:1px}
.scale{display:flex;gap:6px;align-items:center;font-size:13px;color:#57606a;margin:6px 0}
.scale button{border:1px solid #d0d7de;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer}.scale button.on{background:#1f2328;color:#fff}
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
let SCALE=Number(localStorage.getItem('jump-review:scale')||15);
function setScale(s){SCALE=s;localStorage.setItem('jump-review:scale',s);render()}
function median(a){const s=[...a].sort((p,q)=>p-q);const m=s.length>>1;return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):0}
const fmtMm=v=>(v>0?'+':'')+(Math.abs(v)>=100?Math.round(v).toLocaleString('en-US'):v);
const dm=t=>new Date(t).toLocaleDateString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit'});
// Dots (not lines): alternating levels show as two rows of dots instead of a "barcode".
function svg(it,pts,lo,hi,W,H,clip){const P=4;
 const x=t=>P+(t-it.from)/(it.to-it.from)*(W-2*P),yy=v=>H-P-(v-lo)/(hi-lo)*(H-2*P);
 const cl=v=>Math.max(lo,Math.min(hi,v));
 const dots=pts.map(p=>{const o=p[1]<lo||p[1]>hi;return '<circle cx="'+x(p[0]).toFixed(1)+'" cy="'+yy(clip?cl(p[1]):p[1]).toFixed(1)+'" r="'+(o&&clip?2.6:1.9)+'" fill="'+(o&&clip?'#d1242f':'#1f6feb')+'"/>'}).join('');
 const mid=clip?'<line x1="0" x2="'+W+'" y1="'+yy((lo+hi)/2)+'" y2="'+yy((lo+hi)/2)+'" stroke="#d0d7de" stroke-dasharray="2 3"/>':'';
 // weekly grid
 let grid='';for(let t=it.from;t<=it.to;t+=7*864e5)grid+='<line x1="'+x(t)+'" x2="'+x(t)+'" y1="0" y2="'+H+'" stroke="#eef0f2"/>';
 const ev=it.events.map(e=>'<line x1="'+x(e.time)+'" x2="'+x(e.time)+'" y1="0" y2="'+H+'" stroke="#8250df" stroke-width="2" stroke-dasharray="5 3"/>').join('');
 const jx=x(it.time);
 return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+grid+mid+'<rect x="'+(jx-3)+'" y="0" width="6" height="'+H+'" fill="#f59f00" opacity=".5"/>'+ev+dots+'</svg>'}
function axisDates(it){ // LTR: past on the left, later on the right
 const pos=t=>((t-it.from)/(it.to-it.from)*100).toFixed(1)+'%';
 return '<div class="dates"><span style="left:0">'+dm(it.from)+'</span><span class="j" style="left:'+pos(it.time)+'">קפיצה '+dm(it.time)+'</span><span style="right:0">'+dm(it.to)+'</span></div>'}
function chart(it,ax){const pts=it.series[ax.key]||[];if(!pts.length)return '';
 const j=it.jumps[ax.key];
 const c=j?j.before:median(pts.filter(p=>p[0]<it.time).map(p=>p[1]))||pts[0][1];
 const vs=pts.map(p=>p[1]);let lo=Math.min(...vs),hi=Math.max(...vs);if(hi-lo<1){const m=(hi+lo)/2;lo=m-0.5;hi=m+0.5}
 const nOut=pts.filter(p=>Math.abs(p[1]-c)>SCALE).length;
 const head=j?('לפני: <b>'+fmtMm(j.before)+'</b> · אחרי: <b>'+fmtMm(j.after)+'</b> · קפיצה: <b class="'+(Math.abs(j.jump)>=3?'big':'')+'">'+fmtMm(j.jump)+' מ״מ</b>'+(j.alternating?' · <b class="alt">מתחלף בין שתי רמות</b>':'')):'אין מספיק נתונים סביב הקפיצה';
 return '<div class="chart"><h3><span class="ax">'+ax.he+'</span> '+head+'</h3>'+
 '<div class="pair"><div class="main">'+svg(it,pts,c-SCALE,c+SCALE,800,110,true)+axisDates(it)+'<div class="sub">סקאלה קבועה ±'+SCALE+' מ״מ סביב הרמה שלפני הקפיצה'+(nOut?' · <span style="color:#d1242f">'+nOut+' נקודות מחוץ לסקאלה (באדום, בקצה)</span>':'')+'</div></div>'+
 '<div class="mini">'+svg(it,pts,lo,hi,240,110,false)+'<div class="sub">כל הטווח: '+fmtMm(Math.round(lo))+' … '+fmtMm(Math.round(hi))+'</div></div></div></div>'}
function render(){const n=D.items.length,done=D.items.filter(it=>S[it.idx]).length;
 document.getElementById('count').textContent=done+' / '+n;document.getElementById('bar').style.width=(done/n*100)+'%';
 const c=document.getElementById('card');
 if(cur>=n){c.innerHTML='<div class="done"><h2>סיימת 🎉</h2><p>'+done+' מתוך '+n+' נבדקו.</p><button onclick="exportRes()">העתק תוצאות לשליחה</button><pre id="out"></pre></div>';renderList();return}
 const it=D.items[cur],a=S[it.idx]||{};
 c.innerHTML='<div class="top"><div><div class="name">'+it.name+'</div><div class="proj">'+it.project+'</div></div><div class="when">קפיצה ב-'+fmt(it.time)+'</div></div>'+
 '<div class="summary '+it.kind+'">'+it.summary+'</div>'+
 (it.note?'<div class="note">'+it.note+'</div>':'')+
 '<div class="legend"><span>⏱ זמן: עבר משמאל ← → מאוחר מימין</span><span><i class="lg-j"></i>מועד הקפיצה</span><span><i class="lg-b"></i>בייסליין קיים</span><span><i class="lg-r"></i>מחוץ לסקאלה</span></div>'+
 '<div class="scale">סקאלה: '+[5,15,50].map(s=>'<button class="'+(s===SCALE?'on':'')+'" onclick="setScale('+s+')">±'+s+' מ״מ</button>').join('')+'<span>· בצד: כל הטווח</span></div>'+
 D.axes.map(ax=>chart(it,ax)).join('')+
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
