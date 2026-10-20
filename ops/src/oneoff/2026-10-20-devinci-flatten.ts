/**
 * DeVinci — flatten every active prism over its WHOLE history (Hillel 2026-10-20: "iron everything, start at zero").
 *
 * Per prism, from its first sample (raw values only; ingestion-suspect samples ignored):
 *   1. start event at the first sample: initial = median of the first K raw values → the line starts at 0
 *   2. every persistent step (≥ --min mm, K-sample blocks consistent) anywhere in the history → an event at the
 *      step that shifts the zero by exactly the step size on the axes that stepped (≥ --min-shift). Real movement
 *      between steps is kept.
 * All existing baseline events (old re-zeros, today's iron events) are archived to baseline-events-deleted
 * (deleteNote "flatten 2026-10-20") and replaced by this clean set. initial-value mirrors the last new event;
 * status.axes → ok, alert_state.axes → {} (like setBaseline). Raw values are never touched.
 * After --apply: run the MA recompute for the whole history (printed command).
 *
 * Backup: ops/out/devinci-flatten-backup-<ts>.json (events + sensor fields) written before any write.
 * Usage: npx tsx src/oneoff/2026-10-20-devinci-flatten.ts [--k=6] [--min=3] [--min-shift=2] [--apply]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, num, parseArgs, run } from "../lib/cli";
import { projectSensors } from "../lib/sensors";
import { median } from "../lib/signal";
import { enc } from "../lib/iron-backup";

const PROJECT = "hmPh7Hg2fjTc9GyNRDYO";
const AXES = ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"] as const;
const SHORT: Record<string, string> = { EastingDisplacement: "X", NorthingDisplacement: "Y", HeightDisplacement: "Z" };
const BY = "hillel@scanin (oneoff 2026-10-20-devinci-flatten)";
const r1 = (v: number) => Math.round(v * 10) / 10;
/** range without the single lowest and highest value — one wild reading doesn't hide a step */
const spread = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length >= 5 ? s[s.length - 2] - s[1] : s[s.length - 1] - s[0]; };

run(async () => {
  const args = parseArgs();
  const K = num(args.k, 6), minStep = num(args.min, 3), minShift = num(args["min-shift"], 2);
  const sensors = (await projectSensors(PROJECT, "prism")).filter((s) => s.data.active !== false);
  console.log(`\n● ${sensors.length} active prisms — whole history\n`);

  const plans: any[] = [];
  for (const s of sensors) {
    const evSnap = await db.collection(`work-sensors/${s.id}/baseline-events`).get();
    const snap = await db.collection(`work-sensors/${s.id}/data-log`).orderBy("time").get();
    const pts = snap.docs.filter((d) => !d.id.startsWith("daily::")).map((d) => d.data())
      .filter((x) => typeof x.time === "number" && !(x.suspect && x.suspect_reason && !["implausible-jump", "out-of-range"].includes(x.suspect_reason)))
      .map((x) => ({ t: x.time as number, v: Object.fromEntries(AXES.map((a) => [a, parseFloat(x[a])])) as Record<string, number> }))
      .filter((p) => AXES.some((a) => Number.isFinite(p.v[a])));
    if (pts.length < 2) { console.log(`  ${String(s.label).padEnd(7)} skipped (${pts.length} samples)`); continue; }

    // zero at the start
    const head = pts.slice(0, Math.min(K, pts.length));
    const init0: Record<string, number> = {};
    for (const a of AXES) { const m = median(head.map((p) => p.v[a]).filter(Number.isFinite)); if (Number.isFinite(m)) init0[a] = m; }
    // shifts: { index of first sample after the step, per-axis shift }. Zero(t) = init0 + all shifts at or before t.
    const shifts: { idx: number; s: Record<string, number> }[] = [];
    const offsets = () => { // per sample, current zero
      const out: Record<string, number>[] = [];
      const cur: Record<string, number> = { ...init0 };
      const byIdx = new Map<number, Record<string, number>>();
      for (const sh of shifts) { const m = byIdx.get(sh.idx) ?? {}; for (const a of AXES) m[a] = (m[a] ?? 0) + (sh.s[a] ?? 0); byIdx.set(sh.idx, m); }
      for (let i = 0; i < pts.length; i++) { const m = byIdx.get(i); if (m) for (const a of AXES) cur[a] = (cur[a] ?? 0) + (m[a] ?? 0); out.push({ ...cur }); }
      return out;
    };
    // all steps on the corrected series: K-sample blocks either side, both consistent, |median diff| ≥ minStep
    const findSteps = (off: Record<string, number>[]) => {
      const found: { idx: number; mag: number; s: Record<string, number> }[] = [];
      for (let i = K; i <= pts.length - K; i++) {
        const s: Record<string, number> = {};
        let mag = 0;
        for (const a of AXES) {
          const pv: number[] = [], nv: number[] = [];
          for (let j = i - K; j < i; j++) { const v = pts[j].v[a] - (off[j][a] ?? 0); if (Number.isFinite(v)) pv.push(v); }
          for (let j = i; j < i + K; j++) { const v = pts[j].v[a] - (off[j][a] ?? 0); if (Number.isFinite(v)) nv.push(v); }
          if (pv.length < 3 || nv.length < 3) continue;
          const d = median(nv) - median(pv);
          const tol = Math.max(2, Math.abs(d) / 3);
          if (Math.abs(d) >= minShift && spread(nv) <= 2 * tol && spread(pv) <= 2 * tol) s[a] = d;
          if (s[a] !== undefined) mag = Math.max(mag, Math.abs(d));
        }
        if (mag >= minStep) found.push({ idx: i, mag, s });
      }
      return found;
    };
    // fix the biggest remaining step, repeat until none (cap 60)
    for (let iter = 0; iter < 60; iter++) {
      const st = findSteps(offsets());
      if (!st.length) break;
      const big = st.reduce((p, q) => (q.mag > p.mag ? q : p));
      shifts.push({ idx: big.idx, s: big.s });
    }
    const off = offsets();
    const left = findSteps(off).length;
    // events: start + one per sample index where the zero changes
    const events: { time: number; initial: Record<string, number>; note: string }[] = [
      { time: pts[0].t, initial: Object.fromEntries(Object.entries(off[0]).map(([a, v]) => [a, r1(v)])), note: "flatten: start of data (zero)" },
    ];
    const idxs = [...new Set(shifts.map((s) => s.idx))].sort((a, b) => a - b);
    for (const i of idxs) {
      const d = Object.fromEntries(AXES.filter((a) => Math.abs((off[i][a] ?? 0) - (off[i - 1][a] ?? 0)) > 0.05).map((a) => [SHORT[a], r1((off[i][a] ?? 0) - (off[i - 1][a] ?? 0))]));
      if (!Object.keys(d).length) continue;
      events.push({ time: pts[i].t, initial: Object.fromEntries(Object.entries(off[i]).map(([a, v]) => [a, r1(v)])), note: `flatten: step ${JSON.stringify(d)}` });
    }
    const at = (t: number) => { let f = events[0]; for (const e of events) if (e.time <= t) f = e; return f.initial; };
    if (args.dump === String(s.label)) {
      const byDay = new Map<string, Record<string, number[]>>();
      pts.forEach((p, i) => { const k = new Date(p.t).toISOString().slice(0, 10); const m = byDay.get(k) ?? {}; for (const a of AXES) (m[a] ??= []).push(p.v[a] - (off[i][a] ?? 0)); byDay.set(k, m); });
      for (const [k, m] of byDay) console.log(`    ${k} n=${m[AXES[0]].length} ${AXES.map((a) => `${SHORT[a]} ${r1(median(m[a]))}`).join("  ")}`);
      events.forEach((e) => console.log(`    event ${new Date(e.time).toISOString().slice(0, 16)} ${e.note}`));
      for (let i = K; i <= pts.length - K; i++) {
        const a = "HeightDisplacement";
        const pv = pts.slice(i - K, i).map((p, j) => p.v[a] - (off[i - K + j][a] ?? 0)), nv = pts.slice(i, i + K).map((p, j) => p.v[a] - (off[i + j][a] ?? 0));
        const d = median(nv) - median(pv);
        if (Math.abs(d) >= 3) console.log(`    Z cand ${new Date(pts[i].t).toISOString().slice(0, 16)} d=${r1(d)} spreadPrev=${r1(Math.max(...pv) - Math.min(...pv))} spreadNext=${r1(Math.max(...nv) - Math.min(...nv))} nv=${nv.map(r1).join(",")}`);
      }
    }
    const lastVals = pts.slice(-K);
    const now = Object.fromEntries(AXES.map((a) => [SHORT[a], r1(median(lastVals.map((p) => p.v[a] - (at(p.t)[a] ?? 0)).filter(Number.isFinite)))]));
    plans.push({ sensorId: s.id, name: String(s.label), from: pts[0].t, samples: pts.length, oldEvents: evSnap.docs.map((d) => ({ id: d.id, data: enc(d.data()) })), events, left, now,
      sensorFields: { "initial-value": enc(s.data["initial-value"] ?? null), status: enc(s.data.status ?? null), alert_state: enc(s.data.alert_state ?? null) } });
    console.log(`  ${String(s.label).padEnd(7)} from ${new Date(pts[0].t).toISOString().slice(0, 10)} · ${String(pts.length).padStart(4)} samples · old events ${evSnap.size} → new ${events.length} · now X/Y/Z ${now.X}/${now.Y}/${now.Z}${left ? ` · ⚠ ${left} step(s) left` : ""}`);
  }

  const total = plans.reduce((n, p) => n + p.events.length, 0), archived = plans.reduce((n, p) => n + p.oldEvents.length, 0);
  console.log(`\n${plans.length} prisms · ${archived} old events → archive · ${total} new events · ${plans.filter((p) => !p.left).length}/${plans.length} with no step left`);
  if (!(await confirmApply(args, `flatten ${plans.length} DeVinci prisms (${archived} events archived, ${total} new)`))) return;

  const backup = path.resolve(__dirname, `../../out/devinci-flatten-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify({ project: PROJECT, createdAt: new Date().toISOString(), by: BY, plans }, null, 1));
  if (JSON.parse(fs.readFileSync(backup, "utf8")).plans.length !== plans.length) throw new Error("backup verify failed");
  console.log(`💾 ${backup}`);

  const w = new BatchWriter();
  for (const p of plans) {
    const sRef = db.collection("work-sensors").doc(p.sensorId);
    for (const e of p.oldEvents) {
      const ref = sRef.collection("baseline-events").doc(e.id);
      const data = (await ref.get()).data();
      if (!data) continue;
      await w.set(sRef.collection("baseline-events-deleted").doc(e.id), { ...data, deletedAt: FieldValue.serverTimestamp(), deletedBy: BY, deleteNote: "flatten 2026-10-20" });
      await w.delete(ref);
    }
    for (const e of p.events) {
      await w.set(sRef.collection("baseline-events").doc(), { time: e.time, reason: "rebaseline", initial: e.initial, note: e.note, by: BY, createdAt: FieldValue.serverTimestamp() });
    }
    const statusAxes = Object.fromEntries(Object.keys({ ...((p.sensorFields.status as any)?.axes ?? {}) }).map((a) => [a, "ok"]));
    await w.update(sRef, { "initial-value": p.events[p.events.length - 1].initial, "status.axes": statusAxes, "alert_state.axes": {} });
  }
  await w.flush();
  console.log(`✅ ${w.committed} writes. Next — MA over the whole history:\n   (functions build dir) node scripts/recompute-smoothing.js --project=${PROJECT} --days=all --apply`);
});
