/**
 * Read-only audit of `users` WhatsApp recipient fields.
 *
 * Buckets every user with whatsapp.enabled by deliverability:
 *   - chatId vs contact.phoneE164 digit mismatch (deliberate divergence?)
 *   - truncated/short ids (< 11 digits — the 2026-11-02 corruption pattern)
 *   - group jids (@g.us)
 *   - no usable recipient at all
 *
 * Usage: npx tsx src/queries/users-whatsapp.ts
 */
import { db } from "../lib/firebase";
import { run } from "../lib/cli";

run(async () => {
  const digits = (s?: unknown) => String(s ?? "").replace(/@.*$/, "").replace(/[^0-9]/g, "");

  const users = await db.collection("users").get();
  const rows: string[] = [];
  let enabled = 0, mismatch = 0, shortChatId = 0, noRecipient = 0;

  for (const d of users.docs) {
    const u = d.data();
    const wa = u.notifications?.whatsapp;
    if (wa?.enabled !== true) continue;
    enabled++;

    const name = `${u["first-name"] ?? ""} ${u["last-name"] ?? ""}`.trim() || d.id;
    const cid = wa.chatId || "";
    const phone = u.contact?.phoneE164 || "";
    const cd = digits(cid);
    const pd = digits(phone);
    const isGroup = String(cid).endsWith("@g.us");

    const tags: string[] = [];
    if (isGroup) tags.push("group");
    else if (cd && cd.length < 11) { tags.push(`SHORT chatId(${cd.length}d)`); shortChatId++; }
    if (!isGroup && cd && pd && cd !== pd) { tags.push("chatId≠phoneE164"); mismatch++; }
    if (!cd && !pd) { tags.push("NO RECIPIENT"); noRecipient++; }
    if (pd && pd.length < 11) tags.push(`short phoneE164(${pd.length}d)`);
    if (!tags.length) continue;
    rows.push(`${name.padEnd(25)} ${d.id.padEnd(28)} chatId="${cid}" phoneE164="${phone}" :: ${tags.join(", ")}`);
  }

  console.log(`users=${users.size} whatsapp.enabled=${enabled}`);
  console.log(`flagged: ${rows.length}  (chatId≠phoneE164: ${mismatch}, short chatId: ${shortChatId}, no recipient: ${noRecipient})`);
  rows.forEach((r) => console.log("  " + r));
});
