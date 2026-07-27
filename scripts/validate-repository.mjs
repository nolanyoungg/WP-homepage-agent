import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".");
const read = (name) => fs.readFile(path.join(root, name), "utf8");
const errors = [];

const [packageText, lockText, envText, configText, readme, changelog, tasks] = await Promise.all([
  read("package.json"),
  read("package-lock.json"),
  read(".env.example"),
  read("src/config/index.ts"),
  read("README.md"),
  read("docs/CHANGELOG.md"),
  read("docs/IMPLEMENTATION-TASKS.md")
]);
const packageJson = JSON.parse(packageText);
const lock = JSON.parse(lockText);
if (packageJson.version !== lock.version || packageJson.version !== lock.packages?.[""]?.version) {
  errors.push("package.json and package-lock.json versions differ");
}
if (!changelog.includes(`## [${packageJson.version}]`)) {
  errors.push(`docs/CHANGELOG.md lacks version ${packageJson.version}`);
}

const envKeys = [...envText.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]);
const configKeys = [...configText.matchAll(/^[ ]{2}([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1]);
const missingEnvironment = [...new Set(configKeys)].filter((key) => !envKeys.includes(key));
if (missingEnvironment.length) errors.push(`.env.example is missing: ${missingEnvironment.join(", ")}`);
if (new Set(envKeys).size !== envKeys.length) errors.push(".env.example contains duplicate variables");

const requiredScripts = [
  "build", "lint", "test", "validate", "homepage:once", "homepage:worker",
  "homepage:dry-run", "homepage:status", "homepage:reconcile", "homepage:retry",
  "lmstudio:check", "lmstudio:smoke", "relay", "tracker:create",
  "repository:check", "audit:dependencies"
];
for (const script of requiredScripts) {
  if (!packageJson.scripts?.[script]) errors.push(`package.json lacks script: ${script}`);
  if (!readme.includes(`npm run ${script}`) && !["repository:check"].includes(script)) {
    errors.push(`README.md does not document npm run ${script}`);
  }
}

const requiredFiles = [
  ".github/workflows/validate.yml",
  ".github/dependabot.yml",
  "SECURITY.md",
  "LICENSE",
  "docs/DEPENDENCY-RISK.md",
  "docs/RELEASES.md",
  "docs/runbooks/direct-lan.md",
  "docs/runbooks/lm-link.md",
  "docs/runbooks/windows-mac-relay.md",
  "docs/examples/com.wp-homepage-agent.relay.plist"
];
for (const file of requiredFiles) {
  try { await fs.access(path.join(root, file)); }
  catch { errors.push(`Required repository file is missing: ${file}`); }
}

const publicDocumentation = [
  envText,
  readme,
  ...await Promise.all([
    "docs/runbooks/direct-lan.md",
    "docs/runbooks/lm-link.md",
    "docs/runbooks/windows-mac-relay.md"
  ].map(async (name) => read(name).catch(() => "")))
].join("\n");
for (const pattern of [
  /192\.168\.\d+\.\d+/,
  /C:\\Users\\Nolan/i,
  /\bGRASS10\b/i
]) {
  if (pattern.test(publicDocumentation)) errors.push(`Public documentation contains a personal infrastructure value: ${pattern}`);
}

if (/- \[ \] /.test(tasks)) errors.push("Implementation task ledger still contains unchecked tasks");

const legacySources = [
  "src/cli.ts", "src/config.ts", "src/lm-studio.ts", "src/relay.ts",
  "src/tracker.ts", "src/wordpress.ts", "src/workflow.ts", "relay/server.mjs"
];
for (const file of legacySources) {
  try {
    await fs.access(path.join(root, file));
    errors.push(`Legacy implementation still exists: ${file}`);
  } catch {
    // Absence is the expected state for each superseded implementation.
  }
}

if (errors.length) {
  process.stderr.write(`${errors.map((error) => `- ${error}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `${JSON.stringify({ ok: true, version: packageJson.version, environment_variables: envKeys.length, implementation_tasks_complete: true })}\n`
);
