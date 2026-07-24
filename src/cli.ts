import { loadConfig } from "./config.js";
import { SafeLogger } from "./logger.js";
import { HomepageWorkflow } from "./workflow.js";

const dryRun = process.argv.includes("--dry-run");
try {
  const config = loadConfig();
  const workflow = new HomepageWorkflow(config);
  if (dryRun) await workflow.dryRun();
  else await workflow.runOnce();
} catch (error) {
  new SafeLogger().error(dryRun ? "Dry run failed" : "Homepage worker failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
