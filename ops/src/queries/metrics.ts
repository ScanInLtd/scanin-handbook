/**
 * Daily metrics snapshots: system-metrics/{component}/daily/{YYYY-MM-DD}.
 * Usage: npx tsx src/queries/metrics.ts [component] [--days=7]
 *        (no component → list components)
 */
import { db } from "../lib/firebase";
import { num, parseArgs, run } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const component = args._[0];

  if (!component) {
    const refs = await db.collection("system-metrics").listDocuments();
    console.log("Components:\n  " + refs.map((r) => r.id).join("\n  "));
    return;
  }

  const days = num(args.days, 7);
  const snap = await db.collection(`system-metrics/${component}/daily`).orderBy("__name__", "desc").limit(days).get();
  if (snap.empty) throw new Error(`no daily metrics under system-metrics/${component}/daily`);
  snap.docs.reverse().forEach((d) => console.log(`\n● ${d.id}\n  ${Object.entries(d.data()).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n  ")}`));
  console.log();
});
