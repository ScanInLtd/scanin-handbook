/**
 * Read-only: are new samples getting the server-side `smooth` / `eval` write-back (Phase 1/2)?
 * For data-log docs CREATED since --since (default 2h), per sensor type: how many were written back,
 * how many got a smooth value per axis, suspect count, quarters-covered distribution, and the
 * main reasons for a missing smooth (window too small / coverage < 3 quarters are not stored, so
 * "no smooth" is reported together with the window n where available).
 * Scope: active projects, sensors with thresholds, non-vibration.
 * Usage: npx tsx src/analysis/smooth-coverage.ts [--since=2h|ISO] [--project=<id|name>] [--examples=5]
 */
import { db } from "../lib/firebase";
import { num, parseArgs, parseWhen, run, str } from "../lib/cli";
import { projectName, sensorLabel } from "../lib/sensors";

type Row = { type: string; docs: number; writtenBack: number; suspect: number; axes: number; smoothed: number; q: Record<string, number>; nMin: number; nMax: number };

run(async () => {
  const args = parseArgs();
  const since = parseWhen(str(args.since) ?? "2h", 0);
  const examples = num(args.examples, 5);

  let projects = (await db.collection("projects").where("isActive", "==", true).get()).docs.map((d) => ({ id: d.id, name: projectName(d.data()) }));
  const pf = str(args.project);
  if (pf) projects = projects.filter((p) => p.id === pf || p.name.includes(pf));

  const rows = new Map<string, Row>();
  const missing: string[] = [];
  const suspects: string[] = [];
  for (const p of projects) {
    const sensors = (await db.collection("work-sensors").where("location.site", "==", p.id).get()).docs.filter((d) => {
      const s = d.data();
      return s.active !== false && !String(s.type ?? "").startsWith("vibration") && Object.keys(s.thresholds?.axes ?? {}).length;
    });
    for (const sd of sensors) {
      const s = sd.data();
      const axes = Object.keys(s.thresholds.axes);
      const snap = await db.collection(`work-sensors/${sd.id}/data-log`).where("time", ">=", since - 48 * 3.6e6).get();
      const docs = snap.docs.filter((d) => d.createTime.toMillis() >= since && !d.id.startsWith("daily::"));
      if (!docs.length) continue;
      const type = s.type || "(none)";
      const r = rows.get(type) ?? { type, docs: 0, writtenBack: 0, suspect: 0, axes: 0, smoothed: 0, q: {}, nMin: Infinity, nMax: 0 };
      for (const d of docs) {
        const x = d.data();
        r.docs++;
        if (x.smooth || x.eval) r.writtenBack++;
        if (x.suspect) {
          r.suspect++;
          if (suspects.length < examples) suspects.push(`${p.name} / ${sensorLabel(s, sd.id)} (${sd.id}) ${x.suspect_axis ?? ""} ${x.suspect_reason ?? ""}`);
        }
        for (const ax of axes.filter((a) => a in x)) {
          r.axes++;
          if (typeof x.smooth?.[ax] === "number") r.smoothed++;
          else if (!x.suspect && missing.length < examples * 3) missing.push(`${type}  ${p.name} / ${sensorLabel(s, sd.id)} (${sd.id}) ${ax}  n=${x.smooth?.n ?? "-"} q=${x.smooth?.q ?? "-"} eval=${x.eval?.[ax] ?? "-"}`);
        }
        if (x.smooth) {
          const q = String(x.smooth.q ?? "?");
          r.q[q] = (r.q[q] ?? 0) + 1;
          if (typeof x.smooth.n === "number") {
            r.nMin = Math.min(r.nMin, x.smooth.n);
            r.nMax = Math.max(r.nMax, x.smooth.n);
          }
        }
      }
      rows.set(type, r);
    }
  }

  console.log(`\nSamples created since ${new Date(since).toISOString()} — ${projects.length} active projects\n`);
  console.log(`${"type".padEnd(26)} ${"docs".padStart(6)} ${"wroteBack".padStart(9)} ${"suspect".padStart(7)} ${"axes".padStart(6)} ${"smoothed".padStart(8)} ${"%".padStart(5)}  n(min-max)  quarters`);
  [...rows.values()].sort((a, b) => b.docs - a.docs).forEach((r) =>
    console.log(`${r.type.padEnd(26)} ${String(r.docs).padStart(6)} ${String(r.writtenBack).padStart(9)} ${String(r.suspect).padStart(7)} ${String(r.axes).padStart(6)} ${String(r.smoothed).padStart(8)} ${(r.axes ? (100 * r.smoothed) / r.axes : 0).toFixed(0).padStart(5)}  ${r.nMax ? `${r.nMin}-${r.nMax}` : "-"}`.padEnd(80) + `  ${JSON.stringify(r.q)}`));
  if (suspects.length) console.log("\nSuspect examples:\n  " + suspects.join("\n  "));
  if (missing.length) console.log("\nNo-smooth examples:\n  " + missing.join("\n  "));
  console.log();
});
