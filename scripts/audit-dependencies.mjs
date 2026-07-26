import { spawnSync } from "node:child_process";

const documentedAllowlist = new Set([
  "archiver",
  "archiver-utils",
  "brace-expansion",
  "exceljs",
  "glob",
  "minimatch",
  "readdir-glob",
  "rimraf",
  "uuid",
  "zip-stream"
]);
const documentedAdvisorySources = new Set([1119441, 1124334]);

const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
  shell: process.platform === "win32"
});
let report;
try {
  report = JSON.parse(result.stdout || "{}");
} catch {
  process.stderr.write("npm audit did not return valid JSON\n");
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities ?? {};
const names = Object.keys(vulnerabilities);
const critical = names.filter((name) => vulnerabilities[name]?.severity === "critical");
const unexpected = names.filter((name) => !documentedAllowlist.has(name));
const direct = names.filter((name) => vulnerabilities[name]?.isDirect);
const advisorySources = names.flatMap((name) =>
  (vulnerabilities[name]?.via ?? [])
    .filter((entry) => entry && typeof entry === "object" && typeof entry.source === "number")
    .map((entry) => entry.source)
);
const unexpectedAdvisories = [...new Set(advisorySources)]
  .filter((source) => !documentedAdvisorySources.has(source));

const summary = {
  policy: "fail-critical-or-unreviewed",
  production_vulnerabilities: report.metadata?.vulnerabilities ?? {},
  direct_dependencies: direct,
  documented_allowlist: [...documentedAllowlist].filter((name) => names.includes(name)),
  documented_advisory_sources: [...documentedAdvisorySources],
  unexpected_dependencies: unexpected,
  unexpected_advisory_sources: unexpectedAdvisories
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

if (critical.length || unexpected.length || unexpectedAdvisories.length) {
  process.stderr.write(
    `Dependency policy failed. Critical: ${critical.join(", ") || "none"}; unreviewed packages: ${unexpected.join(", ") || "none"}; unreviewed advisories: ${unexpectedAdvisories.join(", ") || "none"}\n`
  );
  process.exit(1);
}

if (names.length) {
  process.stdout.write(
    "Known ExcelJS advisory chain is accepted only under the controls in docs/DEPENDENCY-RISK.md.\n"
  );
}
