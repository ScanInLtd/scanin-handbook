/**
 * מגדל דה וינצי דרום — smoothing for the split sensors + the 09-07 → 09-16 step baselines
 * (Nathan + Hillel, 2026-10-06; follows 2026-10-06-devinci-remap.ts).
 *
 *  1. f6p6 / f7p6 (C6 split by station height): recomputeSmoothing from their first sample.
 *  2. Every active station-5 prism (target of an ATS-5-* map entry) with data on both sides of the
 *     data gap around 07.09–16.09 (a station re-setup: the whole site jumped ~12 mm): setBaseline
 *     reason 'ats-setup' at the time of the 4th sample after the gap. Initial = median of the raw
 *     E/N/H samples in the 24h from that sample (a single sample is too noisy — e.g. A11 right after
 *     the gap: 4.4, −5.2, 7.3, 7.5, 7.8, −10.1 mm). setBaseline recomputes smoothing from that time.
 * Calls the deployed admin callables (same auth path as 2026-10-04-setbaseline-roundtrip.ts).
 * Undo: baseline events are history — a wrong one is superseded by a new setBaseline; nothing is
 * deleted here.
 *
 * Usage (from ops/):
 *   npx tsx src/oneoff/2026-10-06-devinci-baselines.ts            # dry run (plan per sensor)
 *   npx tsx src/oneoff/2026-10-06-devinci-baselines.ts --apply
 */
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { db } from "../lib/firebase";
import { confirmApply, parseArgs, run } from "../lib/cli";

const PROJECT = "hmPh7Hg2fjTc9GyNRDYO";
const PROJECT_ID = "dataloggerdev";
const WEB_API_KEY = "AIzaSyArbYg-vg6aJGgg7sKAfQGkbGP9UVVR0qI"; // public web config key
const FN = (name: string) => `https://us-central1-${PROJECT_ID}.cloudfunctions.net/${name}`;
const AXES = ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"];
const WIN = [Date.parse("2026-09-01T00:00:00Z"), Date.parse("2026-09-22T00:00:00Z")];
const GAP_START = [Date.parse("2026-09-05T00:00:00Z"), Date.parse("2026-09-10T00:00:00Z")];
const GAP_END = [Date.parse("2026-09-14T00:00:00Z"), Date.parse("2026-09-19T00:00:00Z")];
const DAY = 864e5;

const tokenApp = getApps().find((a) => a.name === "token-minter") ??
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID, serviceAccountId: `${PROJECT_ID}@appspot.gserviceaccount.com` }, "token-minter");
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const iso = (t: number) => new Date(t).toISOString().slice(5, 16).replace("T", " ");

run(async () => {
  const args = parseArgs();
  const sensors = new Map((await db.collection("work-sensors").where("location.site", "==", PROJECT).get()).docs.map((s) => [s.id, s]));
  const maps = (await db.collection("ats-device-map").get()).docs.filter((m) => m.id.startsWith("ATS-5-"));
  const station5 = [...new Set(maps.map((m) => m.data().sensorId))].filter((id) => sensors.get(id)?.data().active !== false && sensors.get(id)?.data().type === "prism");

  // 1. split sensors
  const split = [...sensors.values()].filter((s) => ["f6p6", "f7p6"].includes(s.data().name));
  const recompute: { id: string; name: string; from: number }[] = [];
  for (const s of split) {
    const first = (await s.ref.collection("data-log").orderBy("time").limit(1).get()).docs[0]?.data().time;
    if (first) recompute.push({ id: s.id, name: s.data().name, from: first });
  }
  console.log(`RECOMPUTE smoothing (split sensors): ${recompute.map((r) => `${r.name} from ${iso(r.from)}`).join(", ")}`);

  // 2. step baselines
  const plan: { id: string; name: string; time: number; initial: Record<string, number>; n: number; gap: string }[] = [];
  const skipped: string[] = [];
  for (const id of station5) {
    const s = sensors.get(id)!;
    const snap = await s.ref.collection("data-log").where("time", ">=", WIN[0]).where("time", "<=", WIN[1]).orderBy("time").get();
    const t = snap.docs.filter((d) => !d.id.startsWith("daily::") && d.data().source !== "derived:daily" && d.data().isReplay !== true).map((d) => d.data());
    let best: { from: number; to: number; i: number } | null = null;
    for (let i = 1; i < t.length; i++) {
      const g = { from: t[i - 1].time, to: t[i].time, i };
      if (g.from < GAP_START[0] || g.from > GAP_START[1] || g.to < GAP_END[0] || g.to > GAP_END[1]) continue;
      if (!best || g.to - g.from > best.to - best.from) best = g;
    }
    if (!best || best.to - best.from < 3 * DAY || t.length < best.i + 4) { skipped.push(`${s.data().name} (${!best ? "no gap in window / no data on both sides" : "too few samples after the gap"})`); continue; }
    const t4 = t[best.i + 3].time;
    const win = t.filter((x) => x.time >= t4 && x.time < t4 + DAY);
    const initial: Record<string, number> = {};
    for (const a of AXES) { const v = win.map((x) => Number(x[a])).filter(Number.isFinite); if (v.length) initial[a] = Number(median(v).toFixed(4)); }
    if (Object.keys(initial).length < 3) { skipped.push(`${s.data().name} (no E/N/H after the gap)`); continue; }
    plan.push({ id, name: s.data().name, time: t4, initial, n: win.length, gap: `${iso(best.from)} → ${iso(best.to)}` });
  }
  plan.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  console.log(`\nSTEP BASELINES (${plan.length}) — reason ats-setup, time = 4th sample after the gap, initial = median of 24h:`);
  plan.forEach((p) => console.log(`  ${p.name.padEnd(8)} gap ${p.gap} · baseline ${iso(p.time)} · E ${p.initial.EastingDisplacement} N ${p.initial.NorthingDisplacement} H ${p.initial.HeightDisplacement} (n=${p.n})`));
  console.log(`\nSKIPPED (${skipped.length}): ${skipped.sort().join("; ")}`);
  if (!(await confirmApply(args, `recompute ${recompute.length} sensors + ${plan.length} ats-setup baselines at DeVinci`))) return;

  // auth as an admin user
  const admins = await db.collection("users").where("admin", "==", true).get();
  const admin = admins.docs.find((d) => String(d.data().email ?? "").includes("hillel")) ?? admins.docs[0];
  const custom = await getAuth(tokenApp).createCustomToken(admin.id);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const { idToken } = (await r.json()) as any;
  const call = async (fn: string, data: unknown) => {
    const res = await fetch(FN(fn), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ data }) });
    const body = await res.text();
    if (!res.ok) throw new Error(`${fn} ${res.status}: ${body.slice(0, 300)}`);
    return JSON.parse(body).result;
  };
  console.log(`acting as ${admin.data().email}`);
  for (const x of recompute) {
    const out = await call("recomputeSmoothing", { sensorId: x.id, fromTime: x.from });
    console.log(`  ✓ recompute ${x.name}: ${JSON.stringify(out).slice(0, 160)}`);
  }
  for (const p of plan) {
    try {
      const out = await call("setBaseline", { sensorId: p.id, time: p.time, reason: "ats-setup", initial: p.initial, note: "DeVinci station re-setup 07.09–16.09 (Nathan, 2026-10-06): 4th sample after the gap, median of 24h" });
      console.log(`  ✓ ${p.name}: event ${out.eventId}, recompute ${JSON.stringify(out.recompute).slice(0, 100)}`);
    } catch (e: any) { console.log(`  ✗ ${p.name}: ${e.message}`); }
  }
  console.log("✅ done");
});
