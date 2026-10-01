/**
 * Single Firebase Admin entry point for all ops scripts.
 *
 * Auth: Application Default Credentials only (no key files in this repo).
 *   gcloud auth application-default login --account=scanin.link@gmail.com
 *   gcloud auth application-default set-quota-project dataloggerdev
 * `./go.sh` → "Preflight" verifies all of this.
 */
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

export const PROJECT_ID = "dataloggerdev";

if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT_ID) {
  throw new Error(`GCLOUD_PROJECT=${process.env.GCLOUD_PROJECT} but ops is pinned to ${PROJECT_ID}. Unset it.`);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.warn(`⚠️  FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST} — talking to the EMULATOR, not production.`);
}

const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });

export const db = getFirestore(app);
export const auth = getAuth(app);
export { FieldValue, Timestamp };
