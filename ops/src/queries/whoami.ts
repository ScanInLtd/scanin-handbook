/**
 * Connection test: confirms credentials work and which project we're talking to.
 * Usage: npx tsx src/queries/whoami.ts
 */
import { db, PROJECT_ID } from "../lib/firebase";
import { run } from "../lib/cli";

run(async () => {
  const t0 = Date.now();
  const hb = await db.collection("system-heartbeats").limit(20).get();
  console.log(`✅ Connected to Firestore project "${PROJECT_ID}" in ${Date.now() - t0}ms`);
  console.log(`   system-heartbeats docs: ${hb.docs.map((d) => d.id).join(", ") || "(none)"}`);
});
