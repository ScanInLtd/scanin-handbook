/**
 * Dump the sensor-type registry (devices-types/sensors/devices/*) — read-only.
 * Shows per type: chart-axes, axes (and any threshold defaults they carry),
 * plus every other top-level field name, to see what the registry holds today.
 *
 * Usage: ./go.sh run src/queries/device-types-registry.ts [--type=tilt] [--full]
 */
import { db } from "../lib/firebase";
import { parseArgs, run, str } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const only = str(args.type);
  const snap = await db.collection("devices-types/sensors/devices").get();
  console.log(`devices-types/sensors/devices: ${snap.size} types\n`);
  for (const d of snap.docs) {
    if (only && d.id !== only) continue;
    const t = d.data();
    console.log(`● ${d.id}  type=${t.type}  fields=${Object.keys(t).sort().join(",")}`);
    console.log(`  chart-axes=${JSON.stringify(t["chart-axes"] ?? null)}`);
    if (t.axes) {
      for (const [k, v] of Object.entries<any>(t.axes)) console.log(`  axes.${k} = ${JSON.stringify(v)}`);
    }
    for (const key of Object.keys(t).filter((k) => /thresh|default|limit|alert/i.test(k))) {
      console.log(`  ${key} = ${JSON.stringify(t[key])}`);
    }
    if (args.full) console.log(JSON.stringify(t, null, 2));
    console.log();
  }
});
