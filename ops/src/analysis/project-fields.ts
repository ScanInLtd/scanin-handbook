/**
 * Read-only: which fields exist on project docs and how "active"-like fields are distributed.
 * Usage: npx tsx src/analysis/project-fields.ts
 */
import { db } from "../lib/firebase";
import { run } from "../lib/cli";
import { projectName } from "../lib/sensors";

run(async () => {
  const snap = await db.collection("projects").get();
  const fieldCount = new Map<string, number>();
  snap.docs.forEach((d) => Object.keys(d.data()).forEach((k) => fieldCount.set(k, (fieldCount.get(k) ?? 0) + 1)));
  console.log(`${snap.size} projects. Fields (count):`);
  console.log("  " + [...fieldCount].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}(${n})`).join("  "));

  const activeKeys = [...fieldCount.keys()].filter((k) => /active|status|archiv|enabled|closed|hidden/i.test(k));
  for (const k of activeKeys) {
    const dist = new Map<string, number>();
    snap.docs.forEach((d) => {
      const v = JSON.stringify(d.data()[k] ?? null);
      dist.set(v, (dist.get(v) ?? 0) + 1);
    });
    console.log(`\n${k}: ${[...dist].map(([v, n]) => `${v}=${n}`).join("  ")}`);
  }
  if (activeKeys[0]) {
    console.log(`\nProjects by ${activeKeys[0]}:`);
    snap.docs.forEach((d) => console.log(`  ${JSON.stringify(d.data()[activeKeys[0]] ?? null).padEnd(8)} ${d.id}  ${projectName(d.data())}`));
  }
});
