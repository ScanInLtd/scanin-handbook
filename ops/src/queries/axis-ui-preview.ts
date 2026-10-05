/**
 * What the sensor page will show per sensor (read-only): runs the web
 * platform's own `src/app/shared/axis-registry.ts` against production —
 * chart layout, alert rule, chart tabs, threshold-editor axes and their
 * "מתריע / לא מתריע" state (incl. the per-project prism rule projects/{id}.prismAxes).
 * Usage: npx tsx src/queries/axis-ui-preview.ts --sensors=<docId>,<docId>,…
 */
import { db } from "../lib/firebase";
import { list, parseArgs, run } from "../lib/cli";
import {
  AXIS_ALERT_STATE_LABEL,
  alertRuleOf,
  axisAlertState,
  axisDisplay,
  buildLegacyLayoutAxes,
  buildSensorAxes,
  chartLayoutOf,
  prismAxesModeOf,
  chartTabAxes,
  thresholdEditorAxes,
} from "../../../../scanin-web-platform/src/app/shared/axis-registry";

run(async () => {
  for (const id of list(parseArgs().sensors)) {
    const sensor = (await db.doc(`work-sensors/${id}`).get()).data();
    if (!sensor) {
      console.log(`\n${id}: not found`);
      continue;
    }
    const typeDoc = (await db.doc(`devices-types/sensors/devices/${sensor.type}`).get()).data() || {};
    const layout = chartLayoutOf(typeDoc);
    const rule = alertRuleOf(typeDoc);
    const all = buildSensorAxes(typeDoc, sensor);
    const tabs = layout === "timeseries" ? chartTabAxes(all) : buildLegacyLayoutAxes(typeDoc, sensor);
    const editor = rule === "thresholds" ? thresholdEditorAxes(all) : [];
    const project = sensor.location?.site ? (await db.doc(`projects/${sensor.location.site}`).get()).data() : undefined;
    const ctx = { prismAxes: prismAxesModeOf(sensor.type, project) };

    console.log(`\n${sensor.name ?? id} (${id}) type=${sensor.type}  chartLayout=${layout}  alertRule=${rule}  prismAxes=${ctx.prismAxes ?? "—"} (project field: ${project?.prismAxes ?? "missing"})`);
    console.log(`  thresholds.axes keys: ${Object.keys(sensor.thresholds?.axes || {}).join(", ") || "—"}`);
    console.log(`  chart ${layout === "timeseries" ? "tabs" : "data axes (legacy chart-axes)"}: ${tabs.map((a) => `${a.key} → "${axisDisplay(a, a.key)}"`).join(" | ")}`);
    console.log(
      rule === "thresholds"
        ? `  threshold editor: ${editor.map((a) => `${axisDisplay(a, a.key)} [${AXIS_ALERT_STATE_LABEL[axisAlertState(a, ctx)]}${a.alertable ? "" : ", read-only"}${a.suspectJump !== undefined ? `, suspect default ${a.suspectJump}` : ""}]`).join(" | ")}`
        : `  threshold editor: hidden (DIN 4150-3 evaluation)`
    );
  }
});
