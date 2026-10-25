/**
 * Iron the giant prism steps Nathan approved in the 2026-10-20 review (review/jumps-2026-10-20-answers.json,
 * decision "iron"), on any site — generic successor of 2026-10-20-devinci-iron.ts (Hillel 2026-10-25).
 *
 * A "giant" step (≥ --giant mm, default 200) is not structural movement: a wrong point / frame / zero
 * for a while. Ironing = baseline event(s) with reason "iron" (functions stamp continuity:true, so the
 * MA window spans them) that shift the zero by EXACTLY the step on the axes that stepped, so the wrong
 * era lines up with the data around it. Raw values are never touched.
 *
 * Per approved sensor:
 *   1. giant steps over the sensor's whole history (adjusted series = raw − baseline in force; ingestion
 *      suspects implausible-jump / out-of-range included, they ARE the wrong era);
 *   2. approved window = first → last approved time (±2 days). If the level just BEFORE the window is
 *      far from zero (the click was on the return), the window is extended back to the step that started
 *      that era; likewise forward if the level after it stays far from zero and no existing event ends it;
 *   3. every giant step inside the window gets an iron event (time order, each on the series already
 *      corrected by the previous ones). Steps that coincide with an existing reset event are left to it;
 *   4. simulation: no step ≥ --giant left in the window; other giant eras on the sensor are LISTED for
 *      Nathan, not ironed.
 *
 * Output: out/iron-approved-plan-<ts>.json. With --backup, the iron backup (lib/iron-backup.ts) of every
 * planned sensor is written first and recorded in the plan; the apply script refuses to run without it.
 * Apply:  cd <functions build dir> && node <handbook>/ops/src/oneoff/2026-10-25-iron-apply.js <plan.json>
 * Undo:   npx tsx src/oneoff/2026-10-20-devinci-iron-restore.ts --backup=<backup.json> --apply
 *         (deletes exactly the events whose note starts with "iron:" and restores the backed-up fields)
 *
 * SAFETY: check "current level after plan" per sensor — a plan that leaves today's readings far from
 * zero is wrong for that sensor (it flips between levels, e.g. two prisms in one sensor) and must not be
 * applied; run with --only=<ids> for the sensors whose plan is clean.
 *
 * Usage: npx tsx src/oneoff/2026-10-25-iron-approved.ts [--answers=review/jumps-2026-10-20-answers.json] [--only=<sensorId,…>] [--giant=200] [--k=4] [--backup]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, run, str } from "../lib/cli";
import { DAY, H, median } from "../lib/signal";
import { writeBackup } from "../lib/iron-backup";

const AXES = ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"] as const;
const SHORT: Record<string, string> = { EastingDisplacement: "X", NorthingDisplacement: "Y", HeightDisplacement: "Z" };
const BY = "hillel@scanin (oneoff 2026-10-25-iron-approved, Nathan's review 2026-10-20)";
const FAR = 100; // mm: a level this far from zero is a wrong era, not movement

type Pt = { t: number; v: Record<string, number> };
type Ev = { time: number; initial: Record<string, number>; reason?: string; continuity?: boolean };

run(async () => {
  const args = parseArgs();
  const GIANT = num(args.giant, 200), K = num(args.k, 4);
  const answersFile = path.resolve(process.cwd(), str(args.answers) ?? "review/jumps-2026-10-20-answers.json");
  const answers: any[] = JSON.parse(fs.readFileSync(answersFile, "utf8"));
  const bySensor = new Map<string, { name: string; project: string; times: number[] }>();
  const only = new Set((str(args.only) ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  for (const a of answers) {
    if (a.decision !== "iron") continue;
    if (only.size && !only.has(a.sensorId)) continue;
    const e = bySensor.get(a.sensorId) ?? { name: a.name, project: a.project, times: [] as number[] };
    e.times.push(Date.parse(a.time + ":00Z"));
    bySensor.set(a.sensorId, e);
  }

  const plan: any[] = [];
  const checks: any[] = [];
  for (const [sensorId, c] of bySensor) {
    const sDoc = (await db.collection("work-sensors").doc(sensorId).get()).data();
    if (!sDoc || sDoc.active === false) { console.log(`\n${c.project} "${c.name}": inactive / missing — skipped`); continue; }
    const init0 = sDoc["initial-value"] ?? {};
    const existing: Ev[] = (await db.collection(`work-sensors/${sensorId}/baseline-events`).orderBy("time").get()).docs
      .map((d) => d.data() as any).filter((e) => typeof e.time === "number");
    const alreadyIroned = existing.filter((e: any) => String(e.note ?? "").startsWith("iron:"));
    if (alreadyIroned.length) { console.log(`\n${c.project} "${c.name}": already has ${alreadyIroned.length} iron event(s) — skipped`); continue; }
    const isReset = (e: Ev) => e.continuity !== true && e.reason !== "iron";

    const snap = await db.collection(`work-sensors/${sensorId}/data-log`).orderBy("time").get();
    const raw: Pt[] = snap.docs.filter((d) => !d.id.startsWith("daily::")).map((d) => d.data())
      .filter((x) => typeof x.time === "number" && x.isReplay !== true && x.source !== "replay" && x.source !== "derived:daily")
      .filter((x) => !(x.suspect && x.suspect_reason && !["implausible-jump", "out-of-range"].includes(x.suspect_reason)))
      .map((x) => ({ t: x.time as number, v: Object.fromEntries(AXES.map((a) => [a, parseFloat(x[a])])) as Record<string, number> }))
      .filter((p) => AXES.some((a) => Number.isFinite(p.v[a])));

    const planned: Ev[] = [];
    const inForce = (t: number) => {
      let f: Ev | null = null;
      for (const e of [...existing, ...planned].sort((p, q) => p.time - q.time)) if (e.time <= t) f = e;
      return (f?.initial ?? init0) as Record<string, number>;
    };
    const adj = (p: Pt, a: string) => p.v[a] - (Number(inForce(p.t)[a]) || 0);
    const resetBetween = (t1: number, t2: number) => existing.some((e) => isReset(e) && e.time > t1 && e.time <= t2);
    const level = (i0: number, i1: number) => Object.fromEntries(AXES.map((a) => [a, median(raw.slice(Math.max(0, i0), Math.max(0, i1)).map((p) => adj(p, a)).filter(Number.isFinite))]));
    const farFromZero = (lv: Record<string, number>) => AXES.some((a) => Math.abs(lv[a] ?? 0) > FAR);

    /** giant steps on the current corrected series */
    const giantSteps = () => {
      const out: { i: number; t: number; shift: Record<string, number>; mag: number }[] = [];
      for (let i = K; i <= raw.length - K; i++) {
        if (resetBetween(raw[i - 1].t, raw[i].t)) continue;
        const prv = raw.slice(i - K, i), nxt = raw.slice(i, i + K);
        const shift: Record<string, number> = {};
        let mag = 0, consistent = true;
        for (const a of AXES) {
          const pv = prv.map((p) => adj(p, a)).filter(Number.isFinite), nv = nxt.map((p) => adj(p, a)).filter(Number.isFinite);
          if (pv.length < K - 1 || nv.length < K - 1) continue;
          const s = median(nv) - median(pv);
          if (Math.abs(s) >= GIANT) {
            const tol = Math.max(20, Math.abs(s) / 5);
            if (Math.max(...nv) - Math.min(...nv) > 2 * tol || Math.max(...pv) - Math.min(...pv) > 2 * tol) consistent = false;
          }
          shift[a] = s;
          mag = Math.max(mag, Math.abs(s));
        }
        if (mag >= GIANT && consistent) { out.push({ i, t: raw[i].t, shift, mag }); i += K - 1; }
      }
      return out;
    };

    // approved window, extended to the era it belongs to
    let wStart = Math.min(...c.times) - 2 * DAY, wEnd = Math.max(...c.times) + 2 * DAY;
    const steps0 = giantSteps();
    const iFirst = raw.findIndex((p) => p.t >= wStart);
    if (iFirst > 0 && farFromZero(level(iFirst - K, iFirst))) {
      const startStep = [...steps0].reverse().find((s) => s.t < wStart);
      if (startStep) wStart = startStep.t - H;
    }
    const iLast = raw.findIndex((p) => p.t > wEnd);
    if (iLast > 0 && farFromZero(level(iLast, iLast + K)) && !existing.some((e) => isReset(e) && e.time > wEnd)) {
      const endStep = steps0.find((s) => s.t > wEnd);
      if (endStep) wEnd = endStep.t + H;
    }

    // iron every giant step in the window, in time order, re-detecting on the corrected series
    const events: any[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const next = giantSteps().find((s) => s.t >= wStart && s.t <= wEnd);
      if (!next) break;
      const base = inForce(next.t);
      const initial: Record<string, number> = { ...base };
      const applied: Record<string, number> = {};
      for (const a of AXES) if (Math.abs(next.shift[a] ?? 0) >= 2) {
        initial[a] = Math.round(((Number(base[a]) || 0) + next.shift[a]) * 10) / 10;
        applied[SHORT[a]] = Math.round(next.shift[a] * 10) / 10;
      }
      planned.push({ time: next.t, initial, reason: "iron", continuity: true });
      events.push({ time: next.t, applied });
      plan.push({ sensorId, name: c.name, project: c.project, time: next.t, initial, shift: applied,
        note: `iron: ${c.project} "${c.name}" giant step ${new Date(next.t).toISOString().slice(0, 16)} (Nathan 2026-10-20) shift ${JSON.stringify(applied)}` });
    }

    const leftInWindow = giantSteps().filter((s) => s.t >= wStart && s.t <= wEnd);
    const outside = giantSteps().filter((s) => s.t < wStart || s.t > wEnd)
      .map((s) => `${new Date(s.t).toISOString().slice(0, 10)} ${Object.entries(s.shift).filter(([, v]) => Math.abs(v) >= GIANT).map(([a, v]) => `${SHORT[a]}${v > 0 ? "+" : ""}${Math.round(v)}`).join("/")}`);
    const lvAfter = level(raw.length - K, raw.length);
    checks.push({ sensorId, name: c.name, project: c.project, window: [wStart, wEnd], events: events.length, leftInWindow: leftInWindow.length, outside, currentLevel: lvAfter });
    console.log(`\n${c.project} "${c.name}" (${sensorId})  approved ${c.times.map((t) => new Date(t).toISOString().slice(0, 10)).join(", ")}`);
    console.log(`  window ${fmtTime(wStart)} → ${fmtTime(wEnd)}  ·  ${events.length} iron event(s)${leftInWindow.length ? `  ⚠ ${leftInWindow.length} giant step(s) left in window` : "  ✓ window clean"}`);
    events.forEach((e) => console.log(`    + ${new Date(e.time).toISOString().slice(0, 16)}  shift ${JSON.stringify(e.applied)}`));
    if (outside.length) console.log(`  other giant eras (NOT ironed, for Nathan): ${outside.join(" | ")}`);
    console.log(`  current level after plan: ${AXES.map((a) => `${SHORT[a]}=${(lvAfter[a] ?? NaN).toFixed(1)}`).join(" ")} mm`);
  }

  console.log(`\n${plan.length} iron events on ${new Set(plan.map((p) => p.sensorId)).size} prisms · ${checks.filter((c) => !c.leftInWindow).length}/${checks.length} windows clean`);
  let backup: any = null;
  if (args.backup && plan.length) {
    const firstBySensor = new Map<string, number>();
    plan.forEach((p) => firstBySensor.set(p.sensorId, Math.min(firstBySensor.get(p.sensorId) ?? Infinity, p.time)));
    backup = await writeBackup([...firstBySensor].map(([sensorId, from]) => ({ sensorId, from: from - DAY })), BY);
    console.log(`💾 backup ${backup.file} (${backup.sensors} sensors, ${backup.docs} docs, ${(backup.bytes / 1048576).toFixed(1)} MiB, sha256 ${backup.sha256.slice(0, 12)})`);
  }
  const out = path.resolve(__dirname, `../../out/iron-approved-plan-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), by: BY, answers: path.basename(answersFile), giant: GIANT, backup, events: plan, checks }, null, 1));
  console.log(`📄 ${out}`);
});
