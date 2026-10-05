/**
 * Print the axis registry (devices-types/sensors/devices/{type}.axes) — read-only.
 * Usage: npx tsx src/queries/axis-registry.ts [--type=prism]
 */
import { db } from "../lib/firebase";
import { parseArgs, run, str } from "../lib/cli";

run(async () => {
  const only = str(parseArgs().type);
  const snap = await db.collection("devices-types/sensors/devices").get();
  snap.docs
    .filter((d) => !only || d.id === only)
    .forEach((d) => {
      const t = d.data();
      console.log(`\n${d.id}  axesVersion=${t.axesVersion ?? "—"}  chartLayout=${t.chartLayout ?? "—"}  alertRule=${t.alertRule ?? "—"}  smoothingWindowHours=${t.smoothingWindowHours ?? "—"}  chart-axes=${JSON.stringify(t["chart-axes"] ?? null)}`);
      if (!t.axes) return console.log("  (no axes)");
      Object.entries(t.axes as Record<string, any>)
        .sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99))
        .forEach(([k, a]) => console.log(`  ${k}: ${JSON.stringify(a)}`));
    });
});
