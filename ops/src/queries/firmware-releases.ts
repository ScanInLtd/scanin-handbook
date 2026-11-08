/**
 * List datalogger firmware releases + the recommended pointer — read-only.
 * Usage: ./go.sh run src/queries/firmware-releases.ts
 */
import { db } from "../lib/firebase";
import { fmtTime, run } from "../lib/cli";

run(async () => {
  const settings = await db.doc("firmware-release-settings/datalogger").get();
  console.log(`recommendedVersion = ${settings.data()?.recommendedVersion ?? "(none)"}\n`);
  const snap = await db.collection("esp_datalogger_firmware").get();
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => String(a.version).localeCompare(String(b.version)));
  for (const r of rows) {
    const created = r.createdAt?.toMillis?.() ?? r.createdAt;
    console.log(
      `${String(r.version).padEnd(12)} channel=${String(r.channel).padEnd(6)} dirty=${!!r.gitDirty} ` +
      `commit=${String(r.gitCommit ?? "").slice(0, 8)} withdrawn=${!!r.withdrawn} created=${fmtTime(created)}  ${r.title ?? ""}`
    );
  }
});
