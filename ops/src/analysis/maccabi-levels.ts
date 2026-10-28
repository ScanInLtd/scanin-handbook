/**
 * Read-only: Maccabi Yafo R11–R15 — initial-value, thresholds, and the Height MA (smooth) per half-month
 * relative to each prism's first MA value (what the report's zeroed group chart shows) and vs initial-value.
 * Usage: npx tsx src/analysis/maccabi-levels.ts
 */
import { db } from "../lib/firebase";
import { run } from "../lib/cli";
import { median } from "../lib/signal";

const IDS: Record<string, string> = { R11: "ez7QOIidMYCpkqPzqvjE", R12: "mCPL5VROtwlc8by0DFTj", R13: "zoHkA64eoO1BKsdL5Kr4", R14: "6stWmfxjiH3VvBjJ4Fnr", R15: "WsnJcTZnVYHdFFFyqOy9" };

run(async () => {
  for (const [name, id] of Object.entries(IDS)) {
    const s = (await db.collection("work-sensors").doc(id).get()).data()!;
    const init = s["initial-value"]?.HeightDisplacement;
    const th = s.thresholds?.axes?.HeightDisplacement;
    const snap = await db.collection(`work-sensors/${id}/data-log`).orderBy("time").get();
    const pts = snap.docs.map((d) => d.data()).filter((x) => typeof x.smooth?.HeightDisplacement === "number" && !x.suspect);
    const first = pts[0]?.smooth.HeightDisplacement;
    const by = new Map<string, number[]>();
    pts.forEach((x) => { const dt = new Date(x.time); const k = `${dt.toISOString().slice(5, 7)}${dt.getUTCDate() < 16 ? "a" : "b"}`; by.set(k, [...(by.get(k) ?? []), x.smooth.HeightDisplacement]); });
    console.log(`${name} init H=${init} thresholds H=${JSON.stringify(th)} firstMA=${first?.toFixed(2)} (first MA vs init ${(first ?? 0).toFixed(2)})`);
    console.log(`   vs first MA: ${[...by].map(([k, v]) => `${k}:${(median(v) - first).toFixed(1)}`).join(" ")}`);
  }
});
