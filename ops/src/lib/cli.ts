/**
 * Shared CLI helpers: arg parsing, write guard, batched writes, formatting.
 *
 * Convention for every script that WRITES:
 *   - default is a dry run (print what would change)
 *   - pass --apply to write; it asks for an interactive "yes" confirmation
 *   - log every touched doc path so the run can be audited / undone
 */
import * as readline from "node:readline/promises";
import { db, PROJECT_ID } from "./firebase";
import type { DocumentData, DocumentReference, Timestamp, UpdateData, WriteBatch } from "firebase-admin/firestore";

export type Args = { _: string[]; [flag: string]: string | boolean | string[] };

/** `--key=value`, `--flag`, positional → `_`. */
export function parseArgs(argv = process.argv.slice(2)): Args {
  const args: Args = { _: [] };
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] ?? true;
    else args._.push(a);
  }
  return args;
}

export const str = (v: Args[string] | undefined) => (typeof v === "string" ? v : undefined);
export const list = (v: Args[string] | undefined) => (str(v) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export const num = (v: Args[string] | undefined, def: number) => (str(v) !== undefined ? Number(v) : def);

/** Returns true only if --apply was passed AND the user typed the confirmation. Otherwise dry run. */
export async function confirmApply(args: Args, summary: string): Promise<boolean> {
  if (!args.apply) {
    console.log(`\n🔎 DRY RUN — nothing written. Re-run with --apply to execute:\n   ${summary}`);
    return false;
  }
  if (!process.stdin.isTTY) throw new Error("--apply requires an interactive terminal for confirmation");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\n⚠️  About to WRITE to PRODUCTION (${PROJECT_ID}):\n   ${summary}\nType "yes" to continue: `);
  rl.close();
  if (answer.trim() !== "yes") {
    console.log("Aborted.");
    return false;
  }
  return true;
}

/** Batched writer that commits every 400 ops (Firestore limit is 500). */
export class BatchWriter {
  private batch: WriteBatch = db.batch();
  private pending = 0;
  committed = 0;

  async op(fn: (b: WriteBatch) => void) {
    fn(this.batch);
    if (++this.pending >= 400) await this.flush();
  }
  update(ref: DocumentReference, data: UpdateData<DocumentData>) {
    return this.op((b) => b.update(ref, data));
  }
  set(ref: DocumentReference, data: DocumentData, merge = true) {
    return this.op((b) => b.set(ref, data, { merge }));
  }
  delete(ref: DocumentReference) {
    return this.op((b) => b.delete(ref));
  }
  async flush() {
    if (!this.pending) return;
    await this.batch.commit();
    this.committed += this.pending;
    console.log(`  ✓ committed ${this.committed}`);
    this.batch = db.batch();
    this.pending = 0;
  }
}

/** Format epoch-ms / Timestamp / Date as local time (Asia/Jerusalem) + age. */
export function fmtTime(v: unknown): string {
  const ms = toMs(v);
  if (ms === null) return "—";
  const s = new Date(ms).toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" });
  return `${s} (${ago(ms)})`;
}

export function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (v instanceof Date) return v.getTime();
  if (typeof (v as Timestamp).toMillis === "function") return (v as Timestamp).toMillis();
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return Date.parse(v);
  return null;
}

export function ago(ms: number): string {
  const d = Date.now() - ms;
  const abs = Math.abs(d);
  const unit = abs < 3.6e6 ? [60e3, "m"] : abs < 1728e5 ? [3.6e6, "h"] : [864e5, "d"];
  return `${d < 0 ? "in " : ""}${Math.round(abs / (unit[0] as number))}${unit[1]}${d < 0 ? "" : " ago"}`;
}

/** Parse YYYY-MM-DD (local midnight Asia/Jerusalem ≈ UTC+2/3) or relative "3d"/"12h" into epoch ms. */
export function parseWhen(v: string | undefined, def: number): number {
  if (!v) return def;
  const rel = v.match(/^(\d+)([dhm])$/);
  if (rel) return Date.now() - Number(rel[1]) * { d: 864e5, h: 3.6e6, m: 6e4 }[rel[2] as "d" | "h" | "m"];
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new Error(`bad date: ${v} (use YYYY-MM-DD or 3d / 12h / 30m)`);
  return t;
}

export function run(main: () => Promise<void>) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      const msg = String(e?.message ?? e);
      console.error(`\n❌ ${msg}`);
      if (/PERMISSION_DENIED|insufficient permissions|Could not load the default credentials|invalid_grant/i.test(msg)) {
        console.error("   → Auth problem. Run ./go.sh and pick 'Preflight / re-auth'.");
      }
      process.exit(1);
    });
}
