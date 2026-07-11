import fs from "node:fs";
import path from "node:path";

const secretPattern = /authorization|api[_-]?key|token|cookie|secret|password/i;

export function redactEvidence(value: unknown, key = ""): unknown {
  if (secretPattern.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactEvidence(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactEvidence(child, childKey)]));
  return value;
}

type SummaryCheck = { code: string; status: string; severity: string };
type SummaryRun = { runId: string; mode: string; scenarios: Array<{ id: string; status: string; checks: SummaryCheck[] }> };

export function renderSummary(run: SummaryRun): string {
  const rank = (check: SummaryCheck) => check.status === "failed" && check.severity === "P0" ? 0 : check.status === "blocked" ? 1 : check.status === "failed" ? 2 : 3;
  const lines = [`# Demo Material Packs Run ${run.runId}`, "", `- Mode: ${run.mode}`, ""];
  for (const scenario of run.scenarios) {
    lines.push(`## Scenario ${scenario.id}: ${scenario.status}`, "");
    for (const check of [...scenario.checks].sort((a, b) => rank(a) - rank(b))) lines.push(`- ${check.code}: ${check.status} (${check.severity})`);
    lines.push("");
  }
  return lines.join("\n");
}

function atomicWrite(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filePath);
}

export function writeScenarioArtifacts(resultDir: string, scenarioId: string, result: unknown, evidence: unknown) {
  const directory = path.join(resultDir, "scenarios", scenarioId);
  atomicWrite(path.join(directory, "result.json"), JSON.stringify(redactEvidence(result), null, 2));
  atomicWrite(path.join(directory, "evidence.json"), JSON.stringify(redactEvidence(evidence), null, 2));
}

export function writeRunSummary(resultDir: string, run: SummaryRun) {
  atomicWrite(path.join(resultDir, "results.json"), JSON.stringify(redactEvidence(run), null, 2));
  atomicWrite(path.join(resultDir, "summary.md"), renderSummary(run));
}
