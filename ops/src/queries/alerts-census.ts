/**
 * Census of the whole `alerts` collection (read-only) — sizing for tagging /
 * archiving the pre-smoothing (raw-evaluated, untiered) alerts.
 * Usage: npx tsx src/queries/alerts-census.ts
 */
import { db } from "../lib/firebase";
import { fmtTime, run } from "../lib/cli";

run(async () => {
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  let total = 0, oldest = Infinity, newest = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  for (;;) {
    let q = db.collection("alerts").orderBy("__name__").limit(5000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach((d) => {
      const a = d.data();
      total++;
      if (typeof a.time === "number") {
        oldest = Math.min(oldest, a.time);
        newest = Math.max(newest, a.time);
      }
      bump(`type=${a.type ?? "—"} subType=${a.subType ?? "—"} tier=${a.tier ?? "none"}`);
      if (a.hidden !== undefined || a.irrelevant !== undefined || a.archived !== undefined) bump("already has hidden/irrelevant/archived field");
      if (a.active !== undefined) bump(`active=${a.active}`);
    });
    last = snap.docs[snap.docs.length - 1];
  }

  console.log(`alerts: ${total} docs, ${fmtTime(oldest)} … ${fmtTime(newest)}`);
  [...counts].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(7)}  ${k}`));
});
