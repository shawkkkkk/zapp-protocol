import { launchReadiness } from "../src/lib/server/readiness.ts";

const readiness = await launchReadiness();
for (const check of readiness.checks) {
  console.log((check.ok ? "PASS" : "FAIL") + "  " + check.name + "  " + check.detail);
}
console.log(
  (readiness.publicLaunchEnabled ? "PASS" : "FAIL") +
    "  public-launch-gate  " +
    (readiness.publicLaunchEnabled ? "enabled" : "ZAPP_PUBLIC_LAUNCH_ENABLED is not true"),
);
if (!readiness.ready) process.exit(1);
console.log("READY  ZApp public launch prerequisites passed.");
