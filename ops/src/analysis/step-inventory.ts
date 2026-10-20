/**
 * Read-only: inventory of persistent level steps on a project's prisms (E/N/H), from a date,
 * on the adjusted series (raw − baseline event in force). Groups steps across sensors by time
 * (station-wide events) and classifies each as temporary (returns / ends in a re-zero event) or open.
 * Writes a jump-review input JSON (for src/review/jump-review.ts) and prints the groups.
 *
 * Step test: at each sample i, before = median of the previous K samples, after = median of the next K;
 * |after − before| ≥ --min mm, the next K samples agree with each other (spread ≤ max(2, step/3)),
 * and the previous K too. Neighbouring detections are merged to the strongest one.
 *
 * Usage: npx tsx src/analysis/step-inventory.ts <projectId|name> [--from=2026-08-15] [--min=3] [--k=6] [--out=review/<file>.json]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../lib/firebase";
import { num, parseArgs, parseWhen, run, str } from "../lib/cli";
import { projectSensors, resolveProject } from "../lib/sensors";
import { DAY, H, median } from "../lib/signal";

const AXES = [
  { key: "EastingDisplacement", he: "X" },
  { key: "NorthingDisplacement", he: "Y" },
  { key: "HeightDisplacement", he: "Z" },
];

run(async () => {
  const args = parseArgs();
  const project = await resolveProject(args._[0] ?? "");
  const from = parseWhen(str(args.from) ?? "2026-08-15", 0);
  const minStep = num(args.min, 3);
  const K = num(args.k, 6);
  const sensors = (await projectSensors(project.id, "prism")).filter((s) => s.data.active !== false);
  console.log(`\n● ${project.name}: ${sensors.length} active prisms, steps ≥ ${minStep} mm since ${new Date(from).toISOString().slice(0, 10)} (K=${K})\n`);

  type Step = { sensorId: string; name: string; axis: string; time: number; before: number; after: number; size: number; end: number | null; endKind: string };
  const steps: Step[] = [];

  for (const s of sensors) {
    const ev = (await db.collection(`work-sensors/${s.id}/baseline-events`).orderBy("time").get()).docs.map((d) => d.data()).filter((e) => typeof e.time === "number");
    const init = s.data["initial-value"] ?? {};
    const baseAt = (t: number) => { let f: any = null; for (const e of ev) if (e.time <= t) f = e; return f?.initial ?? init; };
    const snap = await db.collection(`work-sensors/${s.id}/data-log`).where("time", ">=", from - 3 * DAY).orderBy("time").get();
    const docs = snap.docs.filter((d) => !d.id.startsWith("daily::")).map((d) => d.data())
      .filter((x) => typeof x.time === "number" && !(x.suspect && x.suspect_reason && !["implausible-jump", "out-of-range"].includes(x.suspect_reason)));
    for (const a of AXES) {
      const pts = docs.map((x) => ({ t: x.time as number, v: parseFloat(x[a.key]) - (Number(baseAt(x.time)[a.key]) || 0) })).filter((p) => Number.isFinite(p.v));
      if (pts.length < 2 * K + 2) continue;
      const cand: Step[] = [];
      for (let i = K; i <= pts.length - K; i++) {
        if (pts[i].t < from) continue;
        const prev = pts.slice(i - K, i).map((p) => p.v), next = pts.slice(i, i + K).map((p) => p.v);
        const b = median(prev), af = median(next), size = af - b;
        if (Math.abs(size) < minStep) continue;
        const tol = Math.max(2, Math.abs(size) / 3);
        if (Math.max(...next) - Math.min(...next) > 2 * tol || Math.max(...prev) - Math.min(...prev) > 2 * tol) continue;
        // a re-zero event exactly at the step (baseline in force changed) is already handled → skip
        if (ev.some((e) => e.time > pts[i - 1].t && e.time <= pts[i].t)) continue;
        cand.push({ sensorId: s.id, name: String(s.label), axis: a.key, time: pts[i].t, before: b, after: af, size, end: null, endKind: "open" });
      }
      // merge neighbours (within 12h) to the strongest
      const merged: Step[] = [];
      for (const c of cand) {
        const last = merged[merged.length - 1];
        if (last && c.time - last.time < 12 * H) { if (Math.abs(c.size) > Math.abs(last.size)) merged[merged.length - 1] = c; }
        else merged.push(c);
      }
      // end of each step: back to the old level (±2 mm, K samples) or a later baseline event
      for (const st of merged) {
        const after = pts.filter((p) => p.t > st.time);
        for (let j = 0; j + K <= after.length; j++) {
          const m = median(after.slice(j, j + K).map((p) => p.v));
          if (Math.abs(m - st.before) <= Math.max(2, Math.abs(st.size) / 5)) { st.end = after[j].t; st.endKind = "returns"; break; }
        }
        const nextEv = ev.find((e) => e.time > st.time && (st.end === null || e.time < st.end));
        if (nextEv) { st.end = nextEv.time; st.endKind = `event:${nextEv.reason}`; }
        steps.push(st);
      }
    }
  }

  // group across sensors by time (±1 day)
  steps.sort((a, b) => a.time - b.time);
  const groups: { t0: number; items: Step[] }[] = [];
  for (const st of steps) {
    const g = groups[groups.length - 1];
    if (g && st.time - g.t0 <= DAY) g.items.push(st); else groups.push({ t0: st.time, items: [st] });
  }
  const fmt = (t: number) => new Date(t).toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).slice(0, 16);
  console.log(`${steps.length} steps on ${new Set(steps.map((s) => s.sensorId)).size} prisms, ${groups.length} time groups\n`);
  for (const g of groups) {
    const sens = new Set(g.items.map((i) => i.sensorId)).size;
    const sizes = g.items.map((i) => i.size);
    const ends = g.items.reduce((m, i) => m.set(i.endKind, (m.get(i.endKind) ?? 0) + 1), new Map<string, number>());
    console.log(`  ${fmt(g.t0)}  prisms=${String(sens).padStart(3)}  steps=${String(g.items.length).padStart(3)}  median ${median(sizes).toFixed(1)} mm  [${Math.min(...sizes).toFixed(1)} … ${Math.max(...sizes).toFixed(1)}]  ends: ${[...ends].map(([k, n]) => `${k}×${n}`).join(", ")}`);
  }

  // review input: one item per (sensor, step time) — axes merged
  const byKey = new Map<string, Step[]>();
  steps.forEach((s) => { const k = `${s.sensorId}|${Math.round(s.time / (6 * H))}`; byKey.set(k, [...(byKey.get(k) ?? []), s]); });
  const items = [...byKey.values()].map((ss) => {
    const main = ss.sort((p, q) => Math.abs(q.size) - Math.abs(p.size))[0];
    const axTxt = ss.map((s) => `${AXES.find((a) => a.key === s.axis)!.he} ${s.size > 0 ? "+" : ""}${s.size.toFixed(1)}`).join(" · ");
    const endTxt = main.endKind === "returns" ? `חוזר ב-${fmt(main.end!).slice(5, 10)}` : main.endKind.startsWith("event:") ? `מסתיים בבייסליין ${main.endKind.slice(6)} ב-${fmt(main.end!).slice(5, 10)}` : "לא חוזר (פתוח)";
    return { sensorId: main.sensorId, time: new Date(main.time).toISOString().slice(0, 16), note: `${axTxt} מ״מ · ${endTxt}`, _t: main.time, _name: main.name };
  }).sort((a, b) => a._t - b._t || a._name.localeCompare(b._name, undefined, { numeric: true }))
    .map(({ _t, _name, ...rest }) => rest);
  const out = path.resolve(process.cwd(), str(args.out) ?? `review/steps-${project.id}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ title: `קפיצות לגיהוץ – ${project.name}`, source: `step-inventory ≥${minStep} mm since ${new Date(from).toISOString().slice(0, 10)}`, items }, null, 2));
  console.log(`\n📄 ${out} (${items.length} review items)`);
});
