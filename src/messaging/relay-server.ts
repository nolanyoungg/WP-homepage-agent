import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import type { MessageAdapter } from "../domain/types.js";

const maxBodyBytes = 12 * 1024 * 1024;
const maxMessageCharacters = 10_000;
const maxAttachmentBytes = 8 * 1024 * 1024;

class RelayRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function authorized(request: IncomingMessage, expectedToken: string): boolean {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(value.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBodyBytes) throw new RelayRequestError(413, "Request body is too large");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RelayRequestError(400, "Request body must be valid JSON");
  }
}

async function temporaryAttachment(value: unknown): Promise<{ path: string; directory: string } | undefined> {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new RelayRequestError(400, "Attachment is invalid");
  const candidate = value as { filename?: unknown; contentBase64?: unknown };
  if (typeof candidate.filename !== "string" || typeof candidate.contentBase64 !== "string") {
    throw new RelayRequestError(400, "Attachment is invalid");
  }
  const filename = basename(candidate.filename);
  if (
    !filename
    || filename !== candidate.filename
    || !/^[A-Za-z0-9._-]{1,255}$/.test(filename)
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(candidate.contentBase64)
  ) {
    throw new RelayRequestError(400, "Attachment is invalid");
  }
  const contents = Buffer.from(candidate.contentBase64, "base64");
  if (
    !contents.length
    || contents.length > maxAttachmentBytes
    || contents.toString("base64") !== candidate.contentBase64
  ) {
    throw new RelayRequestError(400, "Attachment is invalid");
  }
  const directory = await mkdtemp(join(tmpdir(), "wp-homepage-agent-relay-"));
  const attachmentPath = join(directory, filename);
  await writeFile(attachmentPath, contents, { mode: 0o600 });
  return { path: attachmentPath, directory };
}

export interface RelayServerOptions {
  adapter: MessageAdapter;
  token: string;
  recipient: string;
  host?: string;
  port?: number;
  requestTimeoutMs?: number;
}

export interface RunningRelayServer {
  url: string;
  close(): Promise<void>;
}

export async function startRelayServer({
  adapter,
  token,
  recipient,
  host = "127.0.0.1",
  port = 8_787,
  requestTimeoutMs = 30_000
}: RelayServerOptions): Promise<RunningRelayServer> {
  if (token.length < 24) throw new Error("IMESSAGE_RELAY_TOKEN must contain at least 24 characters");
  if (!recipient) throw new Error("IMESSAGE_RECIPIENT is required to start the relay server");
  const server: Server = createServer((request, response) => {
    request.setTimeout(requestTimeoutMs, () => {
      if (!response.headersSent) reply(response, 408, { ok: false, error: "Request timed out" });
      request.destroy();
    });
    void (async () => {
      try {
        if (!authorized(request, token)) throw new RelayRequestError(401, "Unauthorized");
        const url = new URL(request.url ?? "/", "http://localhost");
        if (request.method === "GET" && url.pathname === "/health") {
          await adapter.healthCheck();
          reply(response, 200, { ok: true, data: { status: "ok" } });
          return;
        }
        if (request.method === "GET" && (url.pathname === "/v1/replies" || url.pathname === "/v1/messages")) {
          const since = url.searchParams.get("since") ?? new Date(Date.now() - 86_400_000).toISOString();
          const messages = (await adapter.incoming(since)).slice(0, 100);
          if (url.pathname === "/v1/messages") {
            reply(response, 200, {
              messages: messages.map((message) => ({
                id: message.id,
                sender: message.sender,
                body: message.text,
                receivedAt: message.receivedAt
              }))
            });
          } else {
            reply(response, 200, { ok: true, data: { replies: messages } });
          }
          return;
        }
        if (request.method !== "POST" || url.pathname !== "/v1/messages") {
          throw new RelayRequestError(404, "Not found");
        }
        const payload = await requestBody(request);
        if (!payload || typeof payload !== "object") throw new RelayRequestError(400, "Message payload is required");
        const candidate = payload as {
          text?: unknown;
          body?: unknown;
          recipient?: unknown;
          idempotencyKey?: unknown;
          reviewToken?: unknown;
          attachment?: unknown;
        };
        const legacy = typeof candidate.body === "string";
        const text = legacy ? candidate.body : candidate.text;
        if (typeof text !== "string" || !text || text.length > maxMessageCharacters) {
          throw new RelayRequestError(400, "Message text is invalid");
        }
        if (legacy && candidate.recipient !== recipient) {
          throw new RelayRequestError(400, "Message recipient does not match the configured recipient");
        }
        const idempotencyKey = candidate.idempotencyKey ?? candidate.reviewToken;
        if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
          throw new RelayRequestError(400, "A valid idempotency key is required");
        }
        const attachment = await temporaryAttachment(candidate.attachment);
        try {
          const delivery = await adapter.send(text, idempotencyKey, attachment?.path);
          if (legacy) reply(response, 201, { id: delivery.id });
          else reply(response, 200, { ok: true, data: delivery });
        } finally {
          if (attachment) await rm(attachment.directory, { recursive: true, force: true });
        }
      } catch (error) {
        if (response.headersSent) return;
        const known = error instanceof RelayRequestError
          ? error
          : new RelayRequestError(500, "Relay operation failed");
        reply(response, known.status, { ok: false, error: known.message });
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const printableHost = address.address.includes(":") ? `[${address.address}]` : address.address;
  return {
    url: `http://${printableHost}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}
