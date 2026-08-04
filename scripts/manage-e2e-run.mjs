import { cleanupRetainedE2ERun, e2eRuntimeRoot, listRetainedE2ERuns } from "./e2e-run-lifecycle.mjs";

const [command, target, confirmation] = process.argv.slice(2);

if (command === "list") {
  console.log(JSON.stringify({ runtimeRoot: e2eRuntimeRoot(), runs: listRetainedE2ERuns() }, null, 2));
} else if (command === "cleanup") {
  const [suite, runId, extra] = (target ?? "").split("/");
  if (!suite || !runId || extra || confirmation !== "--confirm") {
    throw new Error("Usage: manage-e2e-run.mjs cleanup <suite>/<run-id> --confirm");
  }
  const cleaned = cleanupRetainedE2ERun({ suite, runId, confirmed: true });
  console.log(JSON.stringify(cleaned, null, 2));
} else {
  throw new Error("Usage: manage-e2e-run.mjs list | cleanup <suite>/<run-id> --confirm");
}
