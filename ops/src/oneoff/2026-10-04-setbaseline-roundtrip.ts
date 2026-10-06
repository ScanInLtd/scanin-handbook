/**
 * setBaseline round-trip test (Signal & Alerts UI acceptance, UI-1.1).
 *
 * Exercises the DEPLOYED setBaseline callable end-to-end as an admin user on a
 * test sensor in בדיקות משרד (j7prfbs8Mord8g4cgNb5), then verifies:
 *   1. baseline-events doc created (reason/by/time/note/initial)
 *   2. work-sensors/{id}.initial-value mirrors the event
 *
 * Auth: mints a custom token for an admin user via IAM signBlob
 * (serviceAccountId), exchanges it for an ID token, calls the callable.
 *
 * Usage: npx tsx src/oneoff/2026-10-04-setbaseline-roundtrip.ts --apply
 *        [--sensor=lpKZ0eGsgnLC0d6j3oVB] [--email=<admin email>]
 *
 * Explicitly requested by Hillel (2026-10-04): "Run the round-trip now from
 * the preview on a test sensor in בדיקות משרד".
 */
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { parseArgs, run, str } from "../lib/cli";

const PROJECT_ID = "dataloggerdev";
const WEB_API_KEY = "AIzaSyArbYg-vg6aJGgg7sKAfQGkbGP9UVVR0qI"; // public web config key
const CALLABLE_URL = `https://us-central1-${PROJECT_ID}.cloudfunctions.net/setBaseline`;
const SERVICE_ACCOUNT_ID = `${PROJECT_ID}@appspot.gserviceaccount.com`;
const TEST_PROJECT = "j7prfbs8Mord8g4cgNb5"; // בדיקות משרד

// lib/cli → lib/firebase already initializes the default app WITHOUT a
// serviceAccountId, so use a dedicated named app for custom-token minting
// (createCustomToken via IAM signBlob needs serviceAccountId under ADC).
const tokenApp =
  getApps().find((a) => a.name === "token-minter") ??
  initializeApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      serviceAccountId: SERVICE_ACCOUNT_ID,
    },
    "token-minter",
  );
const defaultApp = getApps().find((a) => a.name === "[DEFAULT]") ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore(defaultApp);
const auth = getAuth(tokenApp);

run(async () => {
  const args = parseArgs();
  const sensorId = str(args.sensor) ?? "lpKZ0eGsgnLC0d6j3oVB"; // A085E3F365A0_1_j7pr (loadcell, live)

  // Safety: the sensor must belong to the test project
  const sensorDoc = await db.collection("work-sensors").doc(sensorId).get();
  if (!sensorDoc.exists) throw new Error(`sensor ${sensorId} not found`);
  const sensor = sensorDoc.data()!;
  if (sensor.location?.site !== TEST_PROJECT) {
    throw new Error(`sensor ${sensorId} is NOT in בדיקות משרד (site=${sensor.location?.site}) — refusing`);
  }
  console.log(`Sensor: ${sensor.name ?? sensor["scanin-id"]} (${sensorId}), type=${sensor.type}`);
  console.log(`initial-value BEFORE: ${JSON.stringify(sensor["initial-value"] ?? null)}`);

  // Find an admin user to act as
  const emailFilter = str(args.email);
  const admins = await db.collection("users").where("admin", "==", true).get();
  const adminDoc = emailFilter
    ? admins.docs.find((d) => (d.data().email || "").includes(emailFilter))
    : admins.docs.find((d) => (d.data().email || "").includes("hillel")) ?? admins.docs[0];
  if (!adminDoc) throw new Error("no admin user found in users collection");
  console.log(`Acting as admin: ${adminDoc.data().email} (${adminDoc.id})`);

  // --verify: read-only check of the round-trip result (after the dialog was
  // used on the preview UI)
  if (args.verify) {
    const events = await db
      .collection(`work-sensors/${sensorId}/baseline-events`)
      .orderBy("time", "desc")
      .limit(5)
      .get();
    console.log(`\nbaseline-events (newest first, ${events.size}):`);
    events.docs.forEach((d) => console.log(`  ${d.id}: ${JSON.stringify(d.data())}`));
    const after = await db.collection("work-sensors").doc(sensorId).get();
    console.log(`\ninitial-value NOW: ${JSON.stringify(after.data()?.["initial-value"] ?? null)}`);
    console.log(`status.axes NOW: ${JSON.stringify(after.data()?.status?.axes ?? null)}`);
    console.log(`alert_state NOW: ${JSON.stringify(after.data()?.alert_state ?? null)}`);
    return;
  }

  if (!args.apply) {
    console.log("\nDRY RUN — would call setBaseline { reason: 'rebaseline', note: 'signal-ui preview round-trip test' }.");
    console.log("Re-run with --apply to execute.");
    return;
  }

  // Custom token → ID token
  const customToken = await auth.createCustomToken(adminDoc.id);
  const signInRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  if (!signInRes.ok) throw new Error(`token exchange failed: ${signInRes.status} ${await signInRes.text()}`);
  const { idToken } = (await signInRes.json()) as any;

  // Call the deployed callable (same payload the dialog sends)
  const payload = {
    sensorId,
    reason: "rebaseline",
    time: Date.now(),
    note: "signal-ui preview round-trip test (UI-1.1 acceptance)",
  };
  console.log(`\nCalling setBaseline: ${JSON.stringify(payload)}`);
  const callRes = await fetch(CALLABLE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: payload }),
  });
  const callBody = await callRes.text();
  console.log(`Callable response ${callRes.status}: ${callBody}`);
  if (!callRes.ok) throw new Error("callable failed");

  // Verify: event doc + mirrored initial-value
  const events = await db
    .collection(`work-sensors/${sensorId}/baseline-events`)
    .orderBy("time", "desc")
    .limit(3)
    .get();
  console.log(`\nbaseline-events (newest first, ${events.size} shown):`);
  events.docs.forEach((d) => console.log(`  ${d.id}: ${JSON.stringify(d.data())}`));

  const after = await db.collection("work-sensors").doc(sensorId).get();
  console.log(`\ninitial-value AFTER: ${JSON.stringify(after.data()?.["initial-value"] ?? null)}`);
  console.log(`status.axes AFTER: ${JSON.stringify(after.data()?.status?.axes ?? null)}`);
});
