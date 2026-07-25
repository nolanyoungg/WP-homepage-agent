import crypto from "node:crypto";
import { loadConfig } from "../config/index.js";
import { LmStudioClient } from "../lmstudio/client.js";
import { SafeRunLogger } from "../logging/logger.js";
import { runProcess } from "../runtime/process.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const runId = crypto.randomUUID();
  const logger = new SafeRunLogger(runId, config.operations.runLogsDir, [
    config.lmStudio.apiToken ?? "",
    config.liveLink.password,
    config.messaging.relayToken ?? ""
  ]);
  let linkStatus: unknown;
  if (config.lmStudio.connectionMode === "lmlink") {
    let result: Awaited<ReturnType<typeof runProcess>>;
    try {
      result = await runProcess("lms", ["link", "status", "--json"], {
        timeoutMs: config.lmStudio.healthTimeoutMs,
        maxOutputBytes: 1_000_000
      });
    } catch {
      throw new Error("LM Link status check failed; run 'lms link status --json' on the workflow device");
    }
    try {
      linkStatus = JSON.parse(result.stdout) as unknown;
    } catch {
      throw new Error("lms link status --json did not return valid JSON");
    }
    await logger.write("lmlink.status_succeeded", {
      status_checked: true,
      response_type: Array.isArray(linkStatus) ? "array" : typeof linkStatus
    });
  }
  const client = new LmStudioClient(config.lmStudio, logger);
  const selected = await client.healthCheck();
  const result = {
    ok: true,
    run_id: runId,
    connection_mode: config.lmStudio.connectionMode,
    base_url: config.lmStudio.baseUrl,
    required_lm_studio_version: config.lmStudio.minimumVersion,
    confirmed_lm_studio_version: config.lmStudio.confirmedVersion,
    native_api_version: "v1",
    model_key: selected.key,
    model_instance_id: selected.instanceId,
    link_status_checked: linkStatus !== undefined
  };
  await logger.write("lmstudio.check_succeeded", result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
