import { launchReadiness } from "../src/lib/server/readiness.ts";

const requirePublic = process.argv.includes("--public");
const readiness = await launchReadiness();

for (const check of readiness.checks) {
  console.log(
    (check.ok ? "PASS" : "FAIL") +
      "  " +
      check.name +
      "  " +
      check.detail,
  );
}

console.log(
  (readiness.publicLaunchEnabled ? "OPEN" : "LOCK") +
    "  public-launch-gate  " +
    (readiness.publicLaunchEnabled
      ? "enabled"
      : "closed (expected during preflight/canary)"),
);

if (!readiness.infrastructureReady) {
  console.error("NOT READY  one or more infrastructure checks failed.");
  process.exit(1);
}
if (requirePublic && !readiness.publicLaunchEnabled) {
  console.error("NOT PUBLIC  infrastructure passes but the public launch gate is closed.");
  process.exit(1);
}

console.log(
  requirePublic
    ? "READY  ZApp public launch gate and infrastructure both pass."
    : "READY  ZApp infrastructure passes. Keep the public gate closed until the canary passes.",
);
