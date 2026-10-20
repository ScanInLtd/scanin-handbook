/**
 * A4 — DeVinci ironing plan (Nathan's decisions 2026-10-20: iron all 21 events).
 *
 * Ironing = for every confirmed jump, a baseline event at the jump that shifts the zero by EXACTLY the jump
 * size on the axes that jumped (≥ --min-shift mm). It does not re-zero the prism: movement accumulated before
 * the jump is kept. Jumps are processed per prism in time order on the series already corrected by the
 * earlier planned events, so a later return shows up as an opposite step and is corrected the same way.
 * Times that coincide with an existing baseline event (re-baseline / ats-setup) are left to that event.
 *
 * Output: ops/out/devinci-iron-plan-<ts>.json (events + simulation check). With --backup, also writes the
 * iron-backup (lib/iron-backup.ts) of every planned sensor first and records it in the plan.
 * Apply: node ops/src/oneoff/2026-10-20-devinci-iron-apply.js <plan.json> (from a functions build dir).
 *
 * Usage: npx tsx src/oneoff/2026-10-20-devinci-iron.ts [--decisions=review/devinci-iron-decisions-2026-10-20.json] [--k=6] [--min-shift=2] [--backup]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../lib/firebase";
import { num, parseArgs, run, str } from "../lib/cli";
import { DAY, H, median } from "../lib/signal";
import { writeBackup } from "../lib/iron-backup";

const AXES = ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"] as const;
const SHORT: Record<string, string> = { EastingDisplacement: "X", NorthingDisplacement: "Y", HeightDisplacement: "Z" };
const BY = "hillel@scanin (oneoff 2026-10-20-devinci-iron, Nathan's review)";

run(async () => {
  const args = parseArgs();
  const decisionsFile = path.resolve(process.cwd(), str(args.decisions) ?? "review/devinci-iron-decisions-2026-10-20.json");
  const K = num(args.k, 6), minShift = num(args["min-shift"], 2);
  const dec = JSON.parse(fs.readFileSync(decisionsFile, "utf8"));

  // candidate times per sensor (+ the card id for the note)
  const cand = new Map<string, { name: string; times: { t: number; card: string }[] }>();
  for (const d of dec.decisions) {
    if (d.decision !== "iron") continue;
    for (const m of d.members) {
      if ((d.excluded ?? []).includes(m.sensorId)) continue;
      const c = cand.get(m.sensorId) ?? { name: m.name, times: [] };
      c.times.push({ t: Date.parse(m.time + ":00Z"), card: `${d.id} ${d.time.slice(5, 10)}` });
      if (m.endKind === "returns" && m.end) c.times.push({ t: Date.parse(m.end + ":00Z"), card: `${d.id} return` });
      cand.set(m.sensorId, c);
    }
  }
  const only = new Set(str(args.only) ? fs.readFileSync(path.resolve(process.cwd(), str(args.only)!), "utf8").match(/[A-Za-z0-9_-]{15,}/g) ?? [] : []);
  if (only.size) for (const id of [...cand.keys()]) if (!only.has(id)) cand.delete(id);
  console.log(`\n● ${cand.size} prisms to iron (from ${path.basename(decisionsFile)}${only.size ? `, only ${only.size} listed` : ""})\n`);

  const plan: any[] = [];
  const checks: any[] = [];
  for (const [sensorId, c] of cand) {
    const sDoc = (await db.collection("work-sensors").doc(sensorId).get()).data()!;
    const init0 = sDoc["initial-value"] ?? {};
    const existing = (await db.collection(`work-sensors/${sensorId}/baseline-events`).orderBy("time").get()).docs
      .map((d) => d.data() as any).filter((e) => typeof e.time === "number");
    const tMin = Math.min(...c.times.map((x) => x.t));
    // look 14 days back: DeVinci has multi-day gaps (e.g. 26.08→30.08), and the "before" level must come from real samples
    const snap = await db.collection(`work-sensors/${sensorId}/data-log`).where("time", ">=", tMin - 14 * DAY).orderBy("time").get();
    const raw = snap.docs.filter((d) => !d.id.startsWith("daily::")).map((d) => d.data())
      .filter((x) => typeof x.time === "number" && !(x.suspect && x.suspect_reason && !["implausible-jump", "out-of-range"].includes(x.suspect_reason)))
      .map((x) => ({ t: x.time as number, v: Object.fromEntries(AXES.map((a) => [a, parseFloat(x[a])])) as Record<string, number> }));
    const planned: { time: number; initial: Record<string, number> }[] = [];
    const inForce = (t: number) => {
      let f: any = null;
      for (const e of [...existing, ...planned].sort((p, q) => p.time - q.time)) if (e.time <= t) f = e;
      return (f?.initial ?? init0) as Record<string, number>;
    };
    const adj = (p: { t: number; v: Record<string, number> }, a: string) => p.v[a] - (Number(inForce(p.t)[a]) || 0);
    const evBetween = (t1: number, t2: number) => existing.some((e) => e.time > t1 && e.time <= t2);

    const times = [...c.times].sort((p, q) => p.t - q.t).filter((x, i, arr) => i === 0 || x.t - arr[i - 1].t > 6 * H);
    const mine: any[] = [];
    const processTimes = (list: { t: number; card: string }[]) => { for (const { t, card } of list) {
      // refine: the sample index within ±12 h with the biggest step (on the corrected series)
      let best = -1, bestMag = 0, bestShift: Record<string, number> = {};
      for (let i = K; i <= raw.length - 3; i++) {
        if (Math.abs(raw[i].t - t) > 12 * H) continue;
        if (evBetween(raw[i - 1].t, raw[i].t)) continue;
        // next block stops at the next existing event
        const nextEv = existing.find((e) => e.time > raw[i].t)?.time ?? Infinity;
        const nxt = raw.slice(i, i + K).filter((p) => p.t < nextEv);
        if (nxt.length < 3) continue;
        const prv = raw.slice(i - K, i);
        const shift: Record<string, number> = {};
        let mag = 0;
        for (const a of AXES) {
          const s = median(nxt.map((p) => adj(p, a)).filter(Number.isFinite)) - median(prv.map((p) => adj(p, a)).filter(Number.isFinite));
          if (Number.isFinite(s)) { shift[a] = s; mag = Math.max(mag, Math.abs(s)); }
        }
        if (mag > bestMag) { best = i; bestMag = mag; bestShift = shift; }
      }
      if (best < 0 || bestMag < minShift) { mine.push({ card, t, skipped: best < 0 ? "no data / at an existing event" : `remaining step ${bestMag.toFixed(1)} mm < ${minShift}` }); continue; }
      const time = raw[best].t;
      const base = inForce(time);
      const initial: Record<string, number> = { ...base };
      const applied: Record<string, number> = {};
      for (const a of AXES) {
        if (Math.abs(bestShift[a] ?? 0) >= minShift) {
          initial[a] = Math.round(((Number(base[a]) || 0) + bestShift[a]) * 10) / 10;
          applied[SHORT[a]] = Math.round(bestShift[a] * 10) / 10;
        }
      }
      planned.push({ time, initial });
      mine.push({ card, t, time, applied });
      plan.push({ sensorId, name: c.name, time, initial, shift: applied, note: `iron: ${card} (Nathan 2026-10-20) shift ${JSON.stringify(applied)}` });
    } };

    // simulation check: remaining steps ≥ 3 mm on the corrected series, from the first jump to now
    const findRemaining = () => {
      const rem: { t: number; txt: string }[] = [];
      for (const a of AXES) {
        for (let i = K; i <= raw.length - K; i++) {
          if (raw[i].t < tMin - 6 * H || evBetween(raw[i - 1].t, raw[i].t)) continue;
          const prv = raw.slice(i - K, i).map((p) => adj(p, a)), nxt = raw.slice(i, i + K).map((p) => adj(p, a));
          const s = median(nxt) - median(prv);
          const tol = Math.max(2, Math.abs(s) / 3);
          if (Math.abs(s) >= 3 && Math.max(...nxt) - Math.min(...nxt) <= 2 * tol && Math.max(...prv) - Math.min(...prv) <= 2 * tol) {
            rem.push({ t: raw[i].t, txt: `${SHORT[a]} ${s > 0 ? "+" : ""}${s.toFixed(1)} @ ${new Date(raw[i].t).toISOString().slice(5, 16)}` });
            i += K; // skip the rest of this step
          }
        }
      }
      return rem;
    };
    processTimes(times);
    // leftover steps inside the approved window (first approved jump → now) are part of the same events: iron them too (≤ 2 more passes)
    for (let pass = 0; pass < 2; pass++) {
      const rem = findRemaining();
      if (!rem.length) break;
      processTimes(rem.map((r) => ({ t: r.t, card: "leftover" })));
    }
    const remaining = findRemaining().map((r) => r.txt);
    checks.push({ sensorId, name: c.name, events: mine.filter((m) => m.time).length, skipped: mine.filter((m) => m.skipped).length, remaining });
    console.log(`  ${c.name.padEnd(7)} events=${mine.filter((m) => m.time).length} skipped=${mine.filter((m) => m.skipped).length}${remaining.length ? `  ⚠ remaining: ${remaining.join(", ")}` : "  ✓ clean"}`);
  }

  const clean = checks.filter((c) => !c.remaining.length).length;
  console.log(`\n${plan.length} events on ${new Set(plan.map((p) => p.sensorId)).size} prisms · simulation: ${clean}/${checks.length} prisms clean (no step ≥ 3 mm left)`);

  let backup: any = null;
  if (args.backup) {
    const firstBySensor = new Map<string, number>();
    plan.forEach((p) => firstBySensor.set(p.sensorId, Math.min(firstBySensor.get(p.sensorId) ?? Infinity, p.time)));
    backup = await writeBackup([...firstBySensor].map(([sensorId, from]) => ({ sensorId, from })), BY);
    console.log(`💾 backup ${backup.file} (${backup.sensors} sensors, ${backup.docs} docs, ${(backup.bytes / 1048576).toFixed(1)} MiB, sha256 ${backup.sha256.slice(0, 12)})`);
  }
  const out = path.resolve(__dirname, `../../out/devinci-iron-plan-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), by: BY, decisions: path.basename(decisionsFile), backup, events: plan, checks }, null, 1));
  console.log(`📄 ${out}`);
});
