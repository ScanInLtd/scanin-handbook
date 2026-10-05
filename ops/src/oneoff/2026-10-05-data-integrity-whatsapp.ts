/**
 * Enable WhatsApp delivery of internal data-integrity notices (plan §8 decision 4, Hillel 2026-10-05).
 *
 * Writes system-config/data-integrity = { enabled, whatsappGroup, minSeverity } read by the functions'
 * notifyDataIntegrity (on notice creation only; count bumps don't re-send). Messages go through the
 * WhatsApp outbox + single sender (functions-delivery.md). Group: "TerraScan Monitoring Data Alerts"
 * (jid resolved read-only via WaSender GET /api/groups/invite/<code>).
 *
 * Usage:
 *   npx tsx src/oneoff/2026-10-05-data-integrity-whatsapp.ts            # dry run
 *   npx tsx src/oneoff/2026-10-05-data-integrity-whatsapp.ts --apply
 *   npx tsx src/oneoff/2026-10-05-data-integrity-whatsapp.ts --disable --apply   # kill-switch: enabled=false
 */
import { db } from "../lib/firebase";
import { confirmApply, parseArgs, run } from "../lib/cli";

const CONFIG = {
  enabled: true,
  whatsappGroup: "120363412404296225@g.us", // TerraScan Monitoring Data Alerts
  minSeverity: "warning",
};

run(async () => {
  const args = parseArgs();
  const ref = db.doc("system-config/data-integrity");
  const before = (await ref.get()).data() ?? null;
  const after = args.disable ? { ...(before ?? {}), enabled: false } : { ...CONFIG, updatedAt: Date.now(), updatedBy: "handbook oneoff" };
  console.log(`system-config/data-integrity\n  before: ${JSON.stringify(before)}\n  after:  ${JSON.stringify(after)}`);
  if (!(await confirmApply(args, args.disable ? "disable data-integrity WhatsApp" : "enable data-integrity WhatsApp → TerraScan Monitoring Data Alerts"))) return;
  await ref.set(after);
  console.log("✅ done. Only notices created from now on are sent; already-open notices are not re-sent.");
});
