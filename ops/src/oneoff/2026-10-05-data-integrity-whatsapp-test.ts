/**
 * Send two demo messages to the data-integrity WhatsApp group (Hillel, 2026-10-05):
 *  1. a connection test
 *  2. a real example: the open late-data notice of NAVON tilt "8" (Ci5mmC7CTZ9TU0AFKRwG, ~62 days behind)
 * Creates two data-integrity docs with status "resolved" + demo:true, so they never count as open notices
 * and don't touch the real notice's dedupe. notifyDataIntegrity (onCreate) queues them; the single
 * WhatsApp sender delivers within ~1 min.
 *
 * Usage: npx tsx src/oneoff/2026-10-05-data-integrity-whatsapp-test.ts [--apply]
 */
import { db } from "../lib/firebase";
import { confirmApply, parseArgs, run } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const now = Date.now();
  const base = { status: "resolved", resolution: "ignored", resolvedBy: "demo", demo: true, count: 1, openedAt: new Date(now), lastSeenAt: new Date(now), resolvedAt: new Date(now) };
  const docs = [
    {
      ...base, kind: "test", severity: "warning", sensorId: "-", dedupeKey: `test:demo:${now}`,
      message: "בדיקת חיבור: קבוצה זו תקבל התראות פנימיות על איכות נתונים (קריאות חשודות, חיישנים מפגרים, קפיצות מדרגה, חיישנים בהקמה). לא נשלח ללקוחות.",
    },
    {
      ...base, kind: "late-data", severity: "warning", sensorId: "Ci5mmC7CTZ9TU0AFKRwG", projectId: "ge8lO1KCbxU4RnpgL7xs",
      dedupeKey: `late-data:Ci5mmC7CTZ9TU0AFKRwG:demo:${now}`,
      message:
        "נטייה 8 · JTCS_NAVON_HOUSE מעלה נתונים באיחור של ~62 ימים (הלוגר מנקז נתונים שנשמרו). " +
        "קריאות בנות יותר מ-48 שעות לא מתריעות ללקוח. כדאי לבדוק את הלוגר והתקשורת.\n" +
        "https://new-scanin-ui.web.app/s/Ci5mmC7CTZ9TU0AFKRwG",
    },
  ];
  docs.forEach((d) => console.log(`  • ${d.kind}: ${d.message}`));
  if (!(await confirmApply(args, `create 2 demo data-integrity notices → WhatsApp group`))) return;
  for (const d of docs) {
    const ref = await db.collection("data-integrity").add(d);
    console.log(`  created data-integrity/${ref.id}`);
  }
  console.log("✅ queued. The sender delivers within ~1 minute.");
});
