import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "../config/index.js";
import type { MessageAdapter, MessageDelivery, RelayMessage } from "../domain/types.js";
import { writeJsonAtomic } from "../domain/manifest.js";
import { runProcess } from "../runtime/process.js";

const appleEpochMs = 978_307_200_000;
const maxAttachmentBytes = 8 * 1024 * 1024;
const maxRelayResponseBytes = 2 * 1024 * 1024;

const relayEnvelope = <T extends z.ZodTypeAny>(data: T) => z.object({
  ok: z.literal(true),
  data
});

const relayDelivery = relayEnvelope(z.object({
  id: z.string().min(1),
  duplicate: z.boolean().default(false)
}));

const relayReplies = relayEnvelope(z.object({
  replies: z.array(z.object({
    id: z.string().optional(),
    text: z.string(),
    sender: z.string(),
    receivedAt: z.string().datetime()
  })).max(100)
}));

class DeliveryLedger {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async read(): Promise<Record<string, string>> {
    try {
      return z.record(z.string()).parse(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async deliver(key: string, work: () => Promise<string>): Promise<MessageDelivery> {
    const operation = this.queue.then(async () => {
      const entries = await this.read();
      const existing = entries[key];
      if (existing) return { id: existing, duplicate: true };
      const id = await work();
      entries[key] = id;
      await writeJsonAtomic(this.filePath, entries);
      return { id, duplicate: false };
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export class DryRunMessageAdapter implements MessageAdapter {
  async healthCheck(): Promise<void> {}

  async send(_text: string, idempotencyKey: string): Promise<MessageDelivery> {
    return { id: `dry-run-${idempotencyKey}`, duplicate: false };
  }

  async incoming(since: string): Promise<RelayMessage[]> {
    void since;
    return [];
  }
}

export class MacOSMessagesAdapter implements MessageAdapter {
  private readonly ledger: DeliveryLedger;

  constructor(
    private readonly recipient: string,
    private readonly chatDb: string,
    ledgerPath: string
  ) {
    if (process.platform !== "darwin") {
      throw new Error("The macOS Messages adapter can only run on macOS");
    }
    if (!recipient) throw new Error("IMESSAGE_RECIPIENT is required for the macOS Messages adapter");
    this.ledger = new DeliveryLedger(ledgerPath);
  }

  async healthCheck(): Promise<void> {
    const details = await fs.stat(this.chatDb);
    if (!details.isFile()) throw new Error("Messages database is not a file");
    await runProcess("osascript", ["-e", "return \"ok\""], { timeoutMs: 10_000, maxOutputBytes: 64_000 });
    await runProcess("sqlite3", [this.chatDb, "SELECT 1;"], { timeoutMs: 10_000, maxOutputBytes: 64_000 });
  }

  async send(text: string, idempotencyKey: string, attachmentPath?: string): Promise<MessageDelivery> {
    if (!text || text.length > 10_000) throw new Error("iMessage text must contain 1-10,000 characters");
    if (attachmentPath) {
      const details = await fs.stat(attachmentPath);
      if (!details.isFile() || details.size > maxAttachmentBytes) {
        throw new Error("iMessage attachment is invalid or too large");
      }
    }
    return this.ledger.deliver(idempotencyKey, async () => {
      const script = attachmentPath
        ? `on run argv
set targetAddress to item 1 of argv
set messageBody to item 2 of argv
set attachmentPath to item 3 of argv
tell application "Messages"
set targetService to 1st service whose service type = iMessage
set targetBuddy to buddy targetAddress of targetService
send messageBody to targetBuddy
send POSIX file attachmentPath to targetBuddy
end tell
end run`
        : `on run argv
set targetAddress to item 1 of argv
set messageBody to item 2 of argv
tell application "Messages"
set targetService to 1st service whose service type = iMessage
set targetBuddy to buddy targetAddress of targetService
send messageBody to targetBuddy
end tell
end run`;
      await runProcess("osascript", [
        "-e",
        script,
        this.recipient,
        text,
        ...(attachmentPath ? [attachmentPath] : [])
      ], { timeoutMs: 30_000, maxOutputBytes: 256_000 });
      return crypto.randomUUID();
    });
  }

  async incoming(since: string): Promise<RelayMessage[]> {
    if (!Number.isFinite(Date.parse(since))) throw new Error("Message query requires a valid ISO timestamp");
    const sinceNanoseconds = BigInt(Date.parse(since) - appleEpochMs) * 1_000_000n;
    const query = `SELECT m.ROWID, h.id, replace(replace(replace(coalesce(m.text,''), char(9), ' '), char(10), '\\n'), char(13), ''), m.date FROM message m JOIN handle h ON m.handle_id=h.ROWID WHERE h.id=${sqlString(this.recipient)} AND m.is_from_me=0 AND m.text IS NOT NULL AND m.date>${sinceNanoseconds} ORDER BY m.date ASC LIMIT 100;`;
    const result = await runProcess("sqlite3", ["-separator", "\t", this.chatDb, query], {
      timeoutMs: 15_000,
      maxOutputBytes: 2_000_000
    });
    return result.stdout.split("\n").filter(Boolean).flatMap((line) => {
      const [id, sender, escapedText, appleDate] = line.split("\t");
      if (!id || !sender || escapedText === undefined || !appleDate) return [];
      const numericDate = Number(appleDate);
      if (!Number.isFinite(numericDate)) return [];
      return [{
        id,
        sender,
        text: escapedText.replaceAll("\\n", "\n"),
        receivedAt: new Date(appleEpochMs + numericDate / 1_000_000).toISOString()
      }];
    });
  }
}

export class IMessageRelayClient implements MessageAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs: number
  ) {
    if (!/^https?:\/\//.test(baseUrl)) throw new Error("IMESSAGE_RELAY_URL must be an HTTP(S) URL");
    if (token.length < 24) throw new Error("IMESSAGE_RELAY_TOKEN must contain at least 24 characters");
  }

  private async request<T>(
    requestPath: string,
    schema: z.ZodType<T>,
    init: { method?: "GET" | "POST"; body?: unknown } = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${requestPath}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maxRelayResponseBytes) {
      throw new Error("iMessage relay response exceeded the configured safety limit");
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > maxRelayResponseBytes) {
      throw new Error("iMessage relay response exceeded the configured safety limit");
    }
    let value: unknown;
    try { value = raw ? JSON.parse(raw) : undefined; }
    catch { value = undefined; }
    if (!response.ok) throw new Error(`iMessage relay request failed with HTTP ${response.status}`);
    return schema.parse(value);
  }

  async healthCheck(): Promise<void> {
    await this.request("/health", relayEnvelope(z.object({ status: z.literal("ok") })));
  }

  async send(text: string, idempotencyKey: string, attachmentPath?: string): Promise<MessageDelivery> {
    let attachment: { filename: string; contentBase64: string } | undefined;
    if (attachmentPath) {
      const details = await fs.stat(attachmentPath);
      if (!details.isFile() || details.size > maxAttachmentBytes) throw new Error("Relay attachment is invalid or too large");
      attachment = {
        filename: path.basename(attachmentPath),
        contentBase64: (await fs.readFile(attachmentPath)).toString("base64")
      };
    }
    const response = await this.request("/v1/messages", relayDelivery, {
      method: "POST",
      body: { text, idempotencyKey, ...(attachment ? { attachment } : {}) }
    });
    return { id: response.data.id, duplicate: response.data.duplicate ?? false };
  }

  async incoming(since: string): Promise<RelayMessage[]> {
    const url = new URL(`${this.baseUrl}/v1/replies`);
    url.searchParams.set("since", since);
    const response = await this.request(`${url.pathname}${url.search}`, relayReplies);
    return response.data.replies.map((reply, index) => ({
      id: reply.id ?? `relay-${index}-${reply.receivedAt}`,
      text: reply.text,
      sender: reply.sender,
      receivedAt: reply.receivedAt
    }));
  }
}

export function createMessageAdapter(config: AppConfig): MessageAdapter {
  if (config.messaging.adapter === "dry-run") return new DryRunMessageAdapter();
  if (config.messaging.adapter === "macos") {
    return new MacOSMessagesAdapter(
      config.messaging.recipient!,
      config.messaging.chatDb,
      path.join(config.messaging.relayDataDir, "direct-deliveries.json")
    );
  }
  return new IMessageRelayClient(
    config.messaging.relayUrl!,
    config.messaging.relayToken!,
    config.messaging.relayTimeoutMs
  );
}
