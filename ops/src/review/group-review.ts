/**
 * Read-only: build a self-contained, responsive review page (Hebrew, RTL) of level-step GROUPS for a project,
 * so the reviewer decides per station-wide event ("iron all 51 prisms") instead of per sensor.
 * Giant steps (> --giant mm, e.g. prism mix-ups) get their own single-prism cards after the groups.
 * Answers stay in the browser (localStorage); the finish screen copies Hebrew text + JSON (with members),
 * which is the input for the ironing plan.
 *
 * Usage: npx tsx src/review/group-review.ts <projectId|name> [--from=2026-08-15] [--min=3] [--k=6] [--giant=100] [--out=out/group-review.html]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { num, parseArgs, parseWhen, run, str } from "../lib/cli";
import { projectSensors, resolveProject } from "../lib/sensors";
import { DAY, median } from "../lib/signal";
import { detectSteps, groupSteps, loadPrismSeries, PRISM_AXES, SensorData, Step } from "../lib/steps";

const AXIS_HE: Record<string, string> = Object.fromEntries(PRISM_AXES.map((a) => [a.key, a.he]));

run(async () => {
  const args = parseArgs();
  const project = await resolveProject(args._[0] ?? "");
  const from = parseWhen(str(args.from) ?? "2026-08-15", 0);
  const minStep = num(args.min, 3), K = num(args.k, 6), giant = num(args.giant, 100);
  const sensors = (await projectSensors(project.id, "prism")).filter((s) => s.data.active !== false);
  console.log(`● ${project.name}: ${sensors.length} prisms…`);

  const data = new Map<string, SensorData>();
  const steps: Step[] = [];
  for (const s of sensors) {
    const sd = await loadPrismSeries(s, from - 10 * DAY);
    data.set(s.id, sd);
    steps.push(...detectSteps(sd, from, minStep, K));
  }
  const giants = steps.filter((s) => Math.abs(s.size) > giant);
  const normal = steps.filter((s) => Math.abs(s.size) <= giant);
  console.log(`  ${steps.length} steps (${giants.length} giant) on ${new Set(steps.map((s) => s.sensorId)).size} prisms`);

  const r1 = (v: number) => Math.round(v * 10) / 10;
  const thin = (pts: { t: number; v: number }[], max = 220) => {
    const step = Math.max(1, Math.ceil(pts.length / max));
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => [p.t, r1(p.v)]);
  };
  const windowFor = (t0: number, items: Step[]) => {
    const lastEnd = Math.max(t0, ...items.map((i) => i.end ?? t0));
    return { wFrom: t0 - 7 * DAY, wTo: Math.min(Date.now(), Math.max(lastEnd, t0) + 5 * DAY) };
  };
  const evIn = (sd: SensorData, a: number, b: number) => sd.events.filter((e) => e.time >= a && e.time <= b).map((e) => ({ t: e.time, r: e.reason }));

  const cards: any[] = [];
  // ---- group cards
  groupSteps(normal).forEach((g, gi) => {
    // one entry per sensor: its strongest step in the group
    const bySensor = new Map<string, Step>();
    g.items.forEach((s) => { const c = bySensor.get(s.sensorId); if (!c || Math.abs(s.size) > Math.abs(c.size)) bySensor.set(s.sensorId, s); });
    const members = [...bySensor.values()].sort((a, b) => Math.abs(b.size) - Math.abs(a.size));
    const sizes = members.map((m) => m.size);
    const ends = { returns: 0, event: 0, open: 0 };
    members.forEach((m) => { if (m.endKind === "returns") ends.returns++; else if (m.endKind.startsWith("event:")) ends.event++; else ends.open++; });
    const durDays = members.filter((m) => m.end).map((m) => (m.end! - m.time) / DAY);
    const { wFrom, wTo } = windowFor(g.t0, members);
    // samples: spread across sizes (largest, quartiles, smallest) — up to 6
    const idx = members.length <= 6 ? members.map((_, i) => i) : [0, 1, Math.floor(members.length * 0.33), Math.floor(members.length * 0.5), Math.floor(members.length * 0.75), members.length - 1];
    const samples = [...new Set(idx)].map((i) => members[i]).map((m) => {
      const sd = data.get(m.sensorId)!;
      return { sensorId: m.sensorId, name: m.name, axis: AXIS_HE[m.axis], size: r1(m.size), before: r1(m.before),
        pts: thin(sd.series[m.axis].filter((p) => p.t >= wFrom && p.t <= wTo)), ev: evIn(sd, wFrom, wTo) };
    });
    cards.push({
      id: `g${gi}`, kind: "group", t0: g.t0, wFrom, wTo, count: members.length,
      med: r1(median(sizes)), min: r1(Math.min(...sizes)), max: r1(Math.max(...sizes)), ends,
      medDur: durDays.length ? r1(median(durDays)) : null,
      // one scale for the whole group, from the typical (median) step; outliers show in red at the edge
      scale: Math.max(10, Math.ceil(Math.abs(median(sizes)) * 2.2)),
      samples,
      members: members.map((m) => ({ sensorId: m.sensorId, name: m.name, axis: AXIS_HE[m.axis], size: r1(m.size), time: m.time, end: m.end, endKind: m.endKind })),
    });
  });
  // ---- giant single cards: one per prism (its jump and its return together)
  const gByKey = new Map<string, Step[]>();
  giants.forEach((s) => gByKey.set(s.sensorId, [...(gByKey.get(s.sensorId) ?? []), s]));
  [...gByKey.values()].map((ss) => ss.sort((a, b) => a.time - b.time)).sort((a, b) => a[0].time - b[0].time).forEach((ss, i) => {
    const first = ss[0];
    // main axis = the one with the biggest step; the jump = the EARLIEST step on that axis (a later opposite one is the return)
    const mainAxis = [...ss].sort((p, q) => Math.abs(q.size) - Math.abs(p.size))[0].axis;
    const main = ss.find((s) => s.axis === mainAxis)!;
    const sd = data.get(main.sensorId)!;
    const last = ss[ss.length - 1];
    const { wFrom, wTo } = windowFor(first.time, ss);
    // the return = a later step on the same axis, opposite sign, ≥ 6 h after the jump; or the jump's own end
    const ret = ss.find((s) => s.axis === main.axis && s.time > main.time + 6 * 3600e3 && Math.sign(s.size) !== Math.sign(main.size));
    const endT = ret?.time ?? main.end ?? null;
    const t0 = ret ? Math.min(main.time, first.time) : main.time;
    cards.push({
      id: `x${i}`, kind: "giant", t0, wFrom, wTo, count: 1,
      med: r1(main.size), min: r1(main.size), max: r1(main.size),
      ends: { returns: endT ? 1 : 0, event: 0, open: endT ? 0 : 1 },
      medDur: endT ? r1((endT - main.time) / DAY) : null, scale: 0,
      samples: PRISM_AXES.map((a) => ({ sensorId: main.sensorId, name: main.name, axis: a.he, size: r1(ss.find((s) => s.axis === a.key)?.size ?? 0),
        before: 0, pts: thin(sd.series[a.key].filter((p) => p.t >= wFrom && p.t <= wTo)), ev: evIn(sd, wFrom, wTo) })),
      members: ss.map((m) => ({ sensorId: m.sensorId, name: m.name, axis: AXIS_HE[m.axis], size: r1(m.size), time: m.time, end: m.end, endKind: m.endKind })),
    });
  });

  const outPath = path.resolve(process.cwd(), str(args.out) ?? `out/group-review-${new Date().toISOString().slice(0, 10)}.html`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, page({ title: `גיהוץ קפיצות – ${project.name}`, project: project.name, projectId: project.id, generated: Date.now(), cards }));
  console.log(`  ${cards.filter((c) => c.kind === "group").length} group cards + ${cards.filter((c) => c.kind === "giant").length} single cards\n📄 ${outPath}`);
});

function page(D: any): string {
  const json = JSON.stringify(D).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${D.title}</title>
<style>
:root{--bg:#f5f6f8;--card:#fff;--ink:#1d2433;--mute:#6b7385;--line:#e6e8ee;--blue:#2563eb;--blue-soft:#eaf1ff;--red:#d1342f;--red-soft:#fdeceb;--amber:#f2a93b;--violet:#7c4dff;--green:#16a34a;--radius:16px}
*{box-sizing:border-box}html,body{margin:0}
body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Rubik,Heebo,Arial,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
.top{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.92);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
.top .in{max-width:1180px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:16px}
.brand{font-weight:700;font-size:16px}.brand small{display:block;font-weight:500;color:var(--mute);font-size:12px}
.grow{flex:1}.prog{display:flex;align-items:center;gap:10px;color:var(--mute);font-size:13px;font-variant-numeric:tabular-nums}
.bar{width:180px;height:8px;border-radius:99px;background:#eceef3;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#2563eb);transition:width .3s}
main{max-width:1180px;margin:20px auto 120px;padding:0 20px}
.card{background:var(--card);border-radius:var(--radius);box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.06);overflow:hidden}
.grid{display:grid;grid-template-columns:330px 1fr}
.side{padding:24px;border-left:1px solid var(--line);background:linear-gradient(180deg,#fbfcfe,#fff)}
.kicker{font-size:12px;letter-spacing:.06em;color:var(--mute);text-transform:uppercase}
.when{font-size:28px;font-weight:750;margin:2px 0 0;letter-spacing:-.01em}
.when small{display:block;font-size:14px;font-weight:500;color:var(--mute)}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}
.stat{background:#f6f7fb;border-radius:12px;padding:10px 12px}.stat b{display:block;font-size:22px;font-variant-numeric:tabular-nums;direction:ltr;text-align:right}
.stat span{font-size:12px;color:var(--mute)}
.story{font-size:15px;line-height:1.6;background:var(--blue-soft);color:#1e3a8a;border-radius:12px;padding:12px 14px}
.story.warn{background:#fff4e5;color:#8a4b00}
.ends{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;border-radius:99px;padding:4px 10px;background:#f1f3f7;color:#3c4457}
.chip i{width:8px;height:8px;border-radius:50%}
.charts{padding:20px 22px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-content:start}
.mini{border:1px solid var(--line);border-radius:12px;padding:10px 10px 6px;background:#fff}
.mini h4{margin:0 0 4px;font-size:13px;display:flex;justify-content:space-between;gap:6px}
.mini h4 .sz{direction:ltr;font-variant-numeric:tabular-nums;color:var(--mute);font-weight:600}
.mini svg{display:block;width:100%;height:92px;direction:ltr}
.mini .dt{display:flex;justify-content:space-between;direction:ltr;font-size:10.5px;color:var(--mute);margin-top:2px}
.legend{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--mute)}
.legend i{display:inline-block;width:14px;height:8px;border-radius:2px;margin-left:5px;vertical-align:middle}
details.members{border-top:1px solid var(--line);padding:14px 22px}
details.members summary{cursor:pointer;color:var(--mute);font-size:13px;list-style:none}
details.members summary::-webkit-details-marker{display:none}
.mlist{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.m{border:1px solid var(--line);background:#fff;border-radius:99px;padding:4px 10px;font-size:12px;cursor:pointer;user-select:none}
.m b{direction:ltr;display:inline-block;margin-right:4px;color:var(--mute);font-weight:600}
.m.ex{text-decoration:line-through;opacity:.45;background:#f6f7f9}
.hint{font-size:12px;color:var(--mute);margin-top:8px}
.dock{position:fixed;inset:auto 0 0 0;z-index:6;background:rgba(255,255,255,.95);backdrop-filter:blur(10px);border-top:1px solid var(--line);padding:12px 20px calc(12px + env(safe-area-inset-bottom))}
.dock .in{max-width:1180px;margin:0 auto;display:flex;gap:10px;align-items:center}
.btn{border:0;border-radius:12px;padding:13px 18px;font:inherit;font-weight:700;cursor:pointer;transition:transform .05s,box-shadow .15s,background .15s}
.btn:active{transform:translateY(1px)}
.btn.primary{background:var(--blue);color:#fff;flex:2;box-shadow:0 6px 16px rgba(37,99,235,.25)}.btn.primary:hover{background:#1d4ed8}
.btn.real{background:var(--red-soft);color:var(--red);flex:1}.btn.unsure{background:#eef0f4;color:#3c4457;flex:1}
.btn.sel{outline:3px solid rgba(29,36,51,.75);outline-offset:2px}
.btn.ghost{background:transparent;color:var(--mute);padding:13px 10px}
.btn small{display:block;font-weight:500;opacity:.85;font-size:11.5px}
.nav{display:flex;gap:6px;overflow:auto;padding:14px 0 4px;scrollbar-width:thin}
.pill{flex:none;border:1px solid var(--line);background:#fff;border-radius:10px;padding:6px 10px;font-size:12px;cursor:pointer;color:#3c4457;white-space:nowrap}
.pill.cur{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}
.pill.d-iron{background:var(--blue-soft);border-color:#c7d7fe}.pill.d-real{background:var(--red-soft);border-color:#f6c9c6}.pill.d-unsure{background:#eef0f4}
.done{padding:36px;text-align:center}.done h2{margin:0 0 6px;font-size:26px}
.sum{max-width:720px;margin:20px auto;text-align:right}
.sum .row{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);padding:10px 2px;font-size:14px}
.tag{border-radius:99px;padding:2px 10px;font-size:12px;font-weight:700}.tag.iron{background:var(--blue-soft);color:var(--blue)}.tag.real{background:var(--red-soft);color:var(--red)}.tag.unsure{background:#eef0f4;color:#3c4457}.tag.none{background:#f6f7f9;color:var(--mute)}
@media (max-width:980px){.grid{grid-template-columns:1fr}.side{border-left:0;border-bottom:1px solid var(--line)}.charts{grid-template-columns:repeat(2,1fr)}}
@media (max-width:620px){.top .in{padding:10px 14px}.bar{width:90px}main{padding:0 12px;margin-top:12px}.charts{grid-template-columns:1fr;padding:14px}.side{padding:18px}.when{font-size:24px}.btn{padding:12px 10px}.btn small{display:none}.dock{padding:10px 12px calc(10px + env(safe-area-inset-bottom))}}
</style></head><body>
<div class="top"><div class="in"><div class="brand">${D.title}<small>כל כרטיס = אירוע אחד שבו כמה פריזמות קפצו יחד</small></div><div class="grow"></div>
<div class="prog"><span id="cnt"></span><div class="bar"><i id="bar"></i></div></div></div></div>
<main><div id="view"></div><div class="nav" id="nav"></div></main>
<div class="dock" id="dock"></div>
<script>
const D=${json};
const KEY='group-review:'+D.projectId+':'+D.generated;
const S=JSON.parse(localStorage.getItem(KEY)||'{}');
let cur=D.cards.findIndex(c=>!S[c.id]);if(cur<0)cur=D.cards.length;
const save=()=>localStorage.setItem(KEY,JSON.stringify(S));
const tz={timeZone:'Asia/Jerusalem'};
const dDay=t=>new Date(t).toLocaleDateString('he-IL',{...tz,day:'numeric',month:'numeric'});
const dFull=t=>new Date(t).toLocaleDateString('he-IL',{...tz,weekday:'long',day:'numeric',month:'long'});
const dTime=t=>new Date(t).toLocaleTimeString('he-IL',{...tz,hour:'2-digit',minute:'2-digit'});
const mm=v=>(v>0?'+':'')+(Math.abs(v)>=100?Math.round(v).toLocaleString('en-US'):v.toFixed(1));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const LBL={iron:'לגהץ',real:'אמיתי',unsure:'לא בטוח'};
function svg(c,s){const W=320,H=92,P=3,pts=s.pts;if(!pts.length)return '<svg viewBox="0 0 320 92"></svg>';
 let lo,hi;if(c.kind==='group'){lo=s.before-c.scale;hi=s.before+c.scale}else{const v=pts.map(p=>p[1]);lo=Math.min(...v);hi=Math.max(...v);if(hi-lo<2){lo-=1;hi+=1}const pad=(hi-lo)*.08;lo-=pad;hi+=pad}
 const x=t=>P+(t-c.wFrom)/(c.wTo-c.wFrom)*(W-2*P),y=v=>H-P-(Math.max(lo,Math.min(hi,v))-lo)/(hi-lo)*(H-2*P);
 let g='';for(let t=c.wFrom;t<=c.wTo;t+=7*864e5)g+='<line x1="'+x(t)+'" x2="'+x(t)+'" y1="0" y2="'+H+'" stroke="#f0f2f6"/>';
 const base=c.kind==='group'?'<line x1="0" x2="'+W+'" y1="'+y(s.before)+'" y2="'+y(s.before)+'" stroke="#cfd4de" stroke-dasharray="3 3"/>':'';
 const band='<rect x="'+(x(c.t0)-3)+'" y="0" width="6" height="'+H+'" rx="2" fill="#f2a93b" opacity=".35"/>';
 const ev=s.ev.map(e=>'<line x1="'+x(e.t)+'" x2="'+x(e.t)+'" y1="0" y2="'+H+'" stroke="#7c4dff" stroke-width="1.6" stroke-dasharray="4 3"/>').join('');
 const dots=pts.map(p=>{const out=p[1]<lo||p[1]>hi;return '<circle cx="'+x(p[0]).toFixed(1)+'" cy="'+y(p[1]).toFixed(1)+'" r="'+(out?2.4:1.7)+'" fill="'+(out?'#d1342f':'#2563eb')+'"/>'}).join('');
 return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+g+base+band+ev+dots+'</svg>'}
function story(c){if(c.kind==='giant')return {cls:'warn',t:'קפיצה של '+mm(c.med)+' מ״מ בפריזמה אחת – בלתי אפשרית פיזית. כנראה החלפת פריזמה או זיהוי שגוי'+(c.ends.returns?', וחוזרת לרמה הקודמת.':'.')};
 const n=c.count,most=c.ends.returns+c.ends.event;
 let t='ב'+dFull(c.t0)+' סביב '+dTime(c.t0)+', '+(n===1?'פריזמה אחת קפצה':n+' פריזמות קפצו יחד')+' בכ-'+mm(Math.abs(c.med)).replace('+','')+' מ״מ';
 if(most===n)t+=(c.ends.returns===n?' וכולן חזרו לרמה הקודמת':' והקפיצה נסגרה (חזרה או איפוס תחנה)')+(c.medDur!==null?' תוך כ-'+c.medDur+' ימים':'')+'.';
 else if(c.ends.open)t+='. '+c.ends.open+' עדיין לא חזרו.';
 if(n>=5)t+=' קפיצה משותפת לפריזמות רבות באותו רגע מצביעה בדרך כלל על בעיה בתחנה, לא על תזוזת הבניין.';
 return {cls:n>=5||most===n?'':'warn',t}}
function render(){const n=D.cards.length,done=D.cards.filter(c=>S[c.id]&&S[c.id].d).length;
 document.getElementById('cnt').textContent=done+' מתוך '+n;document.getElementById('bar').style.width=(done/n*100)+'%';
 const v=document.getElementById('view'),dock=document.getElementById('dock');
 if(cur>=n){v.innerHTML=finish();dock.innerHTML='<div class="in"><button class="btn ghost" onclick="go(-1)">→ חזרה</button><div class="grow"></div><button class="btn primary" onclick="copyOut()">העתק תוצאות לשליחה</button></div>';nav();return}
 const c=D.cards[cur],a=S[c.id]||{},ex=new Set(a.ex||[]),st=story(c);
 const charts=c.samples.map(s=>'<div class="mini"><h4><span>'+esc(s.name)+(c.kind==='giant'?' · '+s.axis:'')+'</span><span class="sz">'+(c.kind==='giant'?'':s.axis+' ')+mm(s.size)+'</span></h4>'+svg(c,s)+'<div class="dt"><span>'+dDay(c.wFrom)+'</span><span>'+dDay(c.t0)+'</span><span>'+dDay(c.wTo)+'</span></div></div>').join('');
 const scaleTxt=c.kind==='group'?'סקאלה אחידה ±'+c.scale+' מ״מ סביב הרמה שלפני':'סקאלה אוטומטית';
 v.innerHTML='<div class="card"><div class="grid"><div class="side">'+
  '<div class="kicker">'+(c.kind==='group'?'אירוע '+(cur+1):'קפיצה חריגה')+'</div>'+
  '<div class="when">'+dDay(c.t0)+' · '+dTime(c.t0)+'<small>'+dFull(c.t0)+'</small></div>'+
  '<div class="stats"><div class="stat"><b>'+c.count+'</b><span>'+(c.count===1?'פריזמה':'פריזמות')+'</span></div><div class="stat"><b>'+mm(c.med)+'</b><span>מ״מ (חציון)</span></div>'+
  (c.kind==='group'?'<div class="stat"><b>'+mm(c.min)+' … '+mm(c.max)+'</b><span>טווח</span></div>':'')+'<div class="stat"><b>'+(c.medDur!==null?c.medDur:'—')+'</b><span>ימים עד שחזרה</span></div></div>'+
  '<div class="story '+st.cls+'">'+st.t+'</div>'+
  '<div class="ends">'+(c.ends.returns?'<span class="chip"><i style="background:#16a34a"></i>'+c.ends.returns+' חזרו</span>':'')+(c.ends.event?'<span class="chip"><i style="background:#7c4dff"></i>'+c.ends.event+' נסגרו באיפוס</span>':'')+(c.ends.open?'<span class="chip"><i style="background:#d1342f"></i>'+c.ends.open+' עדיין פתוחות</span>':'')+'</div>'+
  '</div><div class="charts">'+charts+
  '<div class="legend"><span>⏱ זמן: משמאל לימין</span><span><i style="background:#f2a93b;opacity:.5"></i>רגע הקפיצה</span><span><i style="background:#7c4dff"></i>בייסליין קיים</span><span><i style="background:#d1342f;border-radius:50%;width:8px"></i>מחוץ לסקאלה</span><span>'+scaleTxt+'</span></div></div></div>'+
  (c.kind==='group'&&c.count>1?'<details class="members" '+(ex.size?'open':'')+'><summary>כל '+c.count+' הפריזמות באירוע ▾ <span class="hint">(לחיצה על פריזמה = להוציא אותה מהגיהוץ)</span></summary><div class="mlist">'+
  c.members.map(m=>'<span class="m '+(ex.has(m.sensorId)?'ex':'')+'" onclick="tog(\\''+m.sensorId+'\\')">'+esc(m.name)+'<b>'+m.axis+' '+mm(m.size)+'</b></span>').join('')+'</div></details>':'')+'</div>';
 dock.innerHTML='<div class="in"><button class="btn ghost" onclick="go(-1)" title="הקודם">→</button>'+
  '<button class="btn primary '+(a.d==='iron'?'sel':'')+'" onclick="pick(\\'iron\\')">'+(c.kind==='group'&&c.count>1?'לגהץ את כל האירוע'+(ex.size?' (ללא '+ex.size+')':''):'לגהץ')+'<small>קפיצה מדומה · מקש 1</small></button>'+
  '<button class="btn real '+(a.d==='real'?'sel':'')+'" onclick="pick(\\'real\\')">אמיתי<small>להשאיר · 2</small></button>'+
  '<button class="btn unsure '+(a.d==='unsure'?'sel':'')+'" onclick="pick(\\'unsure\\')">לא בטוח<small>3</small></button>'+
  '<button class="btn ghost" onclick="go(1)" title="הבא">←</button></div>';
 nav()}
function nav(){document.getElementById('nav').innerHTML=D.cards.map((c,i)=>'<button class="pill '+(S[c.id]&&S[c.id].d?'d-'+S[c.id].d:'')+(i===cur?' cur':'')+'" onclick="cur='+i+';render();scrollTo({top:0,behavior:\\'smooth\\'})">'+(c.kind==='giant'?'⚠️ '+esc(c.samples[0].name)+' ':'')+dDay(c.t0)+' · '+c.count+'</button>').join('')+'<button class="pill'+(cur>=D.cards.length?' cur':'')+'" onclick="cur=D.cards.length;render()">סיום ✓</button>'}
function tog(id){const c=D.cards[cur];const a=S[c.id]=S[c.id]||{};const ex=new Set(a.ex||[]);ex.has(id)?ex.delete(id):ex.add(id);a.ex=[...ex];save();render()}
function pick(d){const c=D.cards[cur];S[c.id]={...(S[c.id]||{}),d,at:new Date().toISOString()};save();cur=Math.min(D.cards.length,cur+1);render();scrollTo({top:0,behavior:'smooth'})}
function go(k){cur=Math.max(0,Math.min(D.cards.length,cur+k));render();scrollTo({top:0,behavior:'smooth'})}
function rows(){return D.cards.map(c=>{const a=S[c.id]||{};return {id:c.id,kind:c.kind,time:new Date(c.t0).toISOString().slice(0,16),count:c.count,medianMm:c.med,decision:a.d||null,excluded:a.ex||[],members:c.members.map(m=>({sensorId:m.sensorId,name:m.name,axis:m.axis,sizeMm:m.size,time:new Date(m.time).toISOString().slice(0,16),end:m.end?new Date(m.end).toISOString().slice(0,16):null,endKind:m.endKind}))}})}
function finish(){const r=rows(),done=r.filter(x=>x.decision).length;
 return '<div class="card"><div class="done"><h2>'+(done===r.length?'סיימת 🎉':'כמעט שם')+'</h2><div style="color:var(--mute)">'+done+' מתוך '+r.length+' אירועים סומנו</div><div class="sum">'+
 r.map((x,i)=>{const c=D.cards[i];return '<div class="row"><span>'+(c.kind==='giant'?'⚠️ '+esc(c.samples[0].name)+' · ':'')+dDay(c.t0)+' '+dTime(c.t0)+' · '+c.count+' פריזמות · '+mm(c.med)+' מ״מ'+(x.excluded.length?' · ללא '+x.excluded.length:'')+'</span><span class="tag '+(x.decision||'none')+'">'+(x.decision?LBL[x.decision]:'לא סומן')+'</span></div>'}).join('')+'</div></div></div>'}
function copyOut(){const r=rows();const txt=D.title+'\\n'+r.map((x,i)=>{const c=D.cards[i];return '• '+(c.kind==='giant'?'⚠️ '+c.samples[0].name+' ':'')+dDay(c.t0)+' '+dTime(c.t0)+' – '+c.count+' פריזמות, '+mm(c.med)+' מ״מ: '+(x.decision?LBL[x.decision]:'—')+(x.excluded.length?' (ללא: '+c.members.filter(m=>x.excluded.includes(m.sensorId)).map(m=>m.name).join(', ')+')':'')}).join('\\n')+'\\n\\nJSON:\\n'+JSON.stringify({projectId:D.projectId,generated:D.generated,decisions:r});
 (navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject()).then(()=>alert('הועתק ✓ אפשר להדביק בוואטסאפ'),()=>{const w=window.open('');w.document.write('<pre dir="rtl">'+esc(txt)+'</pre>')})}
document.addEventListener('keydown',e=>{if(e.target.closest&&e.target.closest('input,textarea'))return;if(e.key==='1')pick('iron');else if(e.key==='2')pick('real');else if(e.key==='3')pick('unsure');else if(e.key==='ArrowLeft')go(1);else if(e.key==='ArrowRight')go(-1)});
render();
</script></body></html>`;
}
