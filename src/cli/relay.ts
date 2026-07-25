import path from "node:path";
import { loadRelayServerConfig } from "../config/index.js";
import { MacOSMessagesAdapter } from "../messaging/adapters.js";
import { startRelayServer } from "../messaging/relay-server.js";

async function main(): Promise<void> {
  const config = loadRelayServerConfig();
  const adapter = new MacOSMessagesAdapter(
    config.recipient,
    config.chatDb,
    path.join(config.dataDir, "relay-deliveries.json")
  );
  await adapter.healthCheck();
  const server = await startRelayServer({
    adapter,
    token: config.token,
    recipient: config.recipient,
    host: config.host,
    port: config.port,
    requestTimeoutMs: config.timeoutMs
  });
  process.stdout.write(`${JSON.stringify({ event: "relay.started", url: server.url })}\n`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await server.close();
  process.stdout.write(`${JSON.stringify({ event: "relay.stopped" })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
