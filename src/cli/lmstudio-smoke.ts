import crypto from "node:crypto";
import { loadConfig } from "../config/index.js";
import { LmStudioClient } from "../lmstudio/client.js";
import { SafeRunLogger } from "../logging/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const runId = crypto.randomUUID();
  const logger = new SafeRunLogger(runId, config.operations.runLogsDir, [
    config.lmStudio.apiToken ?? "",
    config.liveLink.password,
    config.messaging.relayToken ?? ""
  ]);
  const client = new LmStudioClient(config.lmStudio, logger);
  await client.healthCheck();
  const smoke = await client.smoke();
  const result = {
    ok: true,
    run_id: runId,
    response: smoke.text,
    model_key: smoke.metadata.model_key,
    model_instance_id: smoke.metadata.model_instance_id,
    duration_ms: smoke.metadata.duration_ms
  };
  await logger.write("lmstudio.smoke_succeeded", result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
