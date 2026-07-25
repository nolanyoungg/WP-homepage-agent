import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../config/index.js";
import { HomepageWorkflow } from "../workflow/homepage.js";

const usage = `Usage:
  npm run homepage:once -- [--tracker PATH]
  npm run homepage:worker -- [--tracker PATH]
  npm run homepage:dry-run -- --output DIRECTORY [--tracker PATH]
  npm run homepage:status -- [--tracker PATH]
  npm run homepage:reconcile -- --id HOMEPAGE_ID [--tracker PATH]
  npm run homepage:retry -- --id HOMEPAGE_ID [--tracker PATH]
  tsx src/cli/main.ts preflight [--tracker PATH]`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const trackerOverride = option(args, "--tracker");
  const config = loadConfig({
    ...process.env,
    ...(trackerOverride ? { TRACKER_PATH: trackerOverride } : {})
  });
  const workflow = new HomepageWorkflow(config);

  if (command === "once") {
    print(await workflow.runOnce());
    return;
  }
  if (command === "status") {
    print(await workflow.status());
    return;
  }
  if (command === "preflight") {
    await workflow.preflight({ force: true });
    print({ ok: true, run_id: workflow.runId });
    return;
  }
  if (command === "retry") {
    const homepageId = option(args, "--id");
    if (!homepageId) throw new Error("retry requires --id HOMEPAGE_ID");
    print(await workflow.retry(homepageId));
    return;
  }
  if (command === "reconcile") {
    const homepageId = option(args, "--id");
    if (!homepageId) throw new Error("reconcile requires --id HOMEPAGE_ID");
    print(await workflow.reconcile(homepageId));
    return;
  }
  if (command === "dry-run") {
    const output = option(args, "--output");
    if (!output) throw new Error("dry-run requires --output DIRECTORY");
    print(await workflow.generateDryRun(output));
    return;
  }
  if (command === "worker") {
    let stopping = false;
    const stop = (): void => { stopping = true; };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await workflow.preflight({ force: true });
    while (!stopping) {
      try {
        const result = await workflow.runOnce();
        print(result);
        if (!stopping) {
          await delay(
            result.outcome === "no-work" || result.outcome === "awaiting-review"
              ? config.operations.idleBackoffMs
              : config.operations.pollIntervalMs
          );
        }
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        if (!stopping) await delay(config.operations.idleBackoffMs);
      }
    }
    print({ outcome: "stopped", run_id: workflow.runId });
    return;
  }
  throw new Error(`Unknown command: ${command}\n${usage}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
