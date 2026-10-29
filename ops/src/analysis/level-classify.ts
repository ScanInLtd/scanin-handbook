/**
 * Read-only: sort prisms with giant jumps into what a rule can settle and what needs a person.
 *   spikes   — one level only (jumps return at once): nothing to iron;
 *   station  — exactly 2 levels and the only switch is at a known station event (--station=YYYY-MM-DD,
 *              ±2 days, many prisms at once): keep the level from before it (auto);
 *   review   — anything else: goes to the reviewer (review/level-review.ts page).
 * Writes <out>-auto.json (decisions for oneoff/2026-10-25-level-decisions.ts --decisions=) and
 * <out>-review.json (input for review/level-review.ts).
 *
 * Usage: npx tsx src/analysis/level-classify.ts --input=review/steps-navon-2026-10-25.json --station=2026-10-12 --out=review/navon
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../lib/firebase";
import { parseArgs, run, str } from "../lib/cli";
import { type Pt, clusterLevels, periods } from "../lib/levels";

const AXES = ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"];

run(async () => {
  const args = parseArgs();
  const input = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), str(args.input) ?? ""), "utf8"));
  const station = Date.parse(`${str(args.station) ?? "1970-01-01"}T00:00:00Z`);
  const from = Date.parse("2025-01-01T00:00:00Z");
  const ids = [...new Set((input.items as any[]).map((i) => i.sensorId))];
  const auto: any[] = [], review: any[] = [];
  for (const id of ids) {
    const s = (await db.doc(`work-sensors/${id}`).get()).data()!;
    const events = (await db.collection(`work-sensors/${id}/baseline-events`).orderBy("time").get()).docs.map((d) => d.data()).filter((e) => typeof e.time === "number");
    const inForce = (t: number) => { let f: any = null; for (const e of events) if (e.time <= t) f = e; return (f?.initial ?? s["initial-value"] ?? {}) as Record<string, number>; };
    const snap = await db.collection(`work-sensors/${id}/data-log`).where("time", ">=", from).orderBy("time").get();
    const pts: Pt[] = snap.docs.filter((d) => !d.id.startsWith("daily::")).map((d) => d.data())
      .filter((x) => typeof x.time === "number" && x.isReplay !== true && x.source !== "replay" && x.source !== "derived:daily")
      .map((x) => ({ t: x.time, suspect: false, v: AXES.map((a) => parseFloat(x[a]) - (Number(inForce(x.time)[a]) || 0)) }))
      .filter((p) => p.v.some(Number.isFinite));
    const lab = clusterLevels(pts);
    const runs = periods(pts, lab);
    const nLev = Math.max(0, ...lab) + 1;
    const switches = runs.slice(1).map((r) => r.from);
    const kind = nLev < 2 ? "spikes"
      : nLev === 2 && switches.length === 1 && Math.abs(switches[0] - station) < 2 * 864e5 ? "station" : "review";
    console.log(`${String(s.name).padEnd(12)} ${kind.padEnd(8)} ${nLev} levels, ${runs.length} periods${switches.length ? `, switches ${switches.slice(0, 4).map((t) => new Date(t).toISOString().slice(0, 10)).join(" ")}${switches.length > 4 ? " …" : ""}` : ""}`);
    if (kind === "station") auto.push({ sensorId: id, name: String(s.name), keepAt: new Date(switches[0] - 864e5).toISOString(), why: "single switch at the station event — level before it kept" });
    if (kind === "review") review.push({ sensorId: id, context: (input.items as any[]).filter((i) => i.sensorId === id).map((i) => `${i.time.slice(0, 10).split("-").reverse().join(".")}: ${i.note ?? ""}`).join(" · ") });
  }
  const out = str(args.out) ?? "review/levels";
  fs.writeFileSync(path.resolve(process.cwd(), `${out}-auto.json`), JSON.stringify({ items: auto }, null, 2));
  fs.writeFileSync(path.resolve(process.cwd(), `${out}-review.json`), JSON.stringify({ items: review }, null, 2));
  console.log(`\nauto ${auto.length} · review ${review.length} · spikes ${ids.length - auto.length - review.length}  → ${out}-auto.json, ${out}-review.json`);
});
