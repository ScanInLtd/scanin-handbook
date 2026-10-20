/**
 * Read-only: print a Firestore doc (or the newest N docs of a collection) as JSON, long arrays truncated.
 * Usage: npx tsx src/queries/doc-dump.ts <collection/docId>
 *        npx tsx src/queries/doc-dump.ts <collection> --where=field==value [--order=field] [--n=3]
 */
import { db } from "../lib/firebase";
import { num, parseArgs, run, str } from "../lib/cli";

const trunc = (v: unknown, depth = 0): unknown => {
  if (Array.isArray(v)) return v.length > 8 ? [...v.slice(0, 8).map((x) => trunc(x, depth + 1)), `…(+${v.length - 8})`] : v.map((x) => trunc(x, depth + 1));
  if (v && typeof v === "object") {
    if ("toDate" in (v as any)) return (v as any).toDate().toISOString();
    return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, depth > 4 ? "…" : trunc(x, depth + 1)]));
  }
  if (typeof v === "string" && v.length > 300) return v.slice(0, 300) + "…";
  return v;
};

run(async () => {
  const args = parseArgs();
  const path = args._[0];
  if (!path) throw new Error("usage: doc-dump.ts <collection/docId> | <collection> --where=f==v");
  if (path.split("/").length % 2 === 0) {
    const d = await db.doc(path).get();
    console.log(JSON.stringify(trunc(d.data()), null, 2));
    return;
  }
  let q: FirebaseFirestore.Query = db.collection(path);
  const w = str(args.where);
  if (w) {
    const [f, v] = w.split("==");
    q = q.where(f, "==", v);
  }
  const o = str(args.order);
  if (o) q = q.orderBy(o, "desc");
  const snap = await q.limit(num(args.n, 3)).get();
  snap.docs.forEach((d) => console.log(`── ${path}/${d.id}\n${JSON.stringify(trunc(d.data()), null, 2)}`));
});
