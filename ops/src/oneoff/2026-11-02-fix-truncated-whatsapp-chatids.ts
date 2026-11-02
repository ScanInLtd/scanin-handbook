/**
 * Fix truncated `notifications.whatsapp.chatId` values.
 *
 * 8 users have `chatId` values truncated to "+972" + 5 digits (e.g. Nathan
 * Ganish: "+97258556" instead of "+972585566891"). handleAlerts prefers
 * `chatId` over `contact.phoneE164`, so every WhatsApp send for these users
 * fails with WaSender 422 "JID does not exist" (~162 failures/day, and the
 * reason Nathan gets no WhatsApp alerts — e.g. Navon vibration DIN alerts).
 * `contact.phoneE164` holds the correct full number for all of them.
 * Fix: set chatId = trimmed phoneE164 (the same value the UI stores).
 *
 * Usage:
 *   npx tsx src/oneoff/2026-11-02-fix-truncated-whatsapp-chatids.ts           # dry run
 *   npx tsx src/oneoff/2026-11-02-fix-truncated-whatsapp-chatids.ts --apply   # write (asks "yes")
 *
 * Undo: the previous chatId is preserved in `notifications.whatsapp.chatIdPrev`.
 */
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const digits = (s?: string) => (s || "").replace(/[^0-9]/g, "");

  const users = await db.collection("users").get();
  const plan = users.docs
    .map((d) => {
      const u = d.data();
      const wa = u.notifications?.whatsapp;
      if (!wa?.enabled || !wa.chatId) return null;
      const cid = digits(wa.chatId);
      const phone = (u.contact?.phoneE164 || "").trim();
      const ph = digits(phone);
      // Broken: chatId shorter than a real intl number AND phone looks valid
      if (cid.length >= 11 || ph.length < 11) return null;
      if (cid !== ph.slice(0, cid.length)) return null; // not a truncation of phoneE164 — skip, needs review
      return {
        ref: d.ref,
        label: `${u["first-name"] ?? ""} ${u["last-name"] ?? ""}`.trim() || d.id,
        before: wa.chatId,
        after: phone,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  console.log(`Planned fixes: ${plan.length}`);
  plan.forEach((p) => console.log(`  ${p.label.padEnd(25)} ${p.ref.id}  ${p.before}  →  ${p.after}`));

  if (!plan.length || !(await confirmApply(args, `fix whatsapp.chatId on ${plan.length} user docs`))) return;

  const w = new BatchWriter();
  for (const p of plan) {
    await w.update(p.ref, {
      "notifications.whatsapp.chatId": p.after,
      "notifications.whatsapp.chatIdPrev": p.before,
    });
  }
  await w.flush();
  console.log(`done: ${w.committed} user docs updated`);
});
