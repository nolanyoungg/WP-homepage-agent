import type { MessageAdapter, MessageDelivery, RelayMessage } from "../src/domain/types.js";
import { IMessageRelayClient } from "../src/messaging/adapters.js";
import { approvalText, parseApproval } from "../src/messaging/approval.js";
import { startRelayServer } from "../src/messaging/relay-server.js";
import { afterEach, describe, expect, test } from "vitest";

const token = "a-secure-test-token-with-32-characters";
const recipient = "+15551234567";
const servers: Array<{ close(): Promise<void> }> = [];

class ContractAdapter implements MessageAdapter {
  readonly deliveries = new Map<string, string>();
  fail = false;
  replies?: RelayMessage[];

  async healthCheck(): Promise<void> {
    if (this.fail) throw new Error("private database detail");
  }

  async send(_text: string, idempotencyKey: string): Promise<MessageDelivery> {
    if (this.fail) throw new Error("private Messages database detail");
    const existing = this.deliveries.get(idempotencyKey);
    if (existing) return { id: existing, duplicate: true };
    const id = `delivery-${this.deliveries.size + 1}`;
    this.deliveries.set(idempotencyKey, id);
    return { id, duplicate: false };
  }

  async incoming(since: string): Promise<RelayMessage[]> {
    void since;
    return this.replies ?? [{
      id: "reply-1",
      text: "YES homepage-001 nonce123 — make this preview the Local site's homepage",
      sender: recipient,
      receivedAt: "2026-07-25T12:01:00.000Z"
    }];
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("shared relay contract", () => {
  test("supports authenticated health, delivery idempotence, and bounded replies", async () => {
    const adapter = new ContractAdapter();
    const server = await startRelayServer({ adapter, token, recipient, port: 0 });
    servers.push(server);
    const client = new IMessageRelayClient(server.url, token, 2_000);
    await expect(client.healthCheck()).resolves.toBeUndefined();
    expect(await client.send("Review it", "review_token_123")).toEqual({
      id: "delivery-1",
      duplicate: false
    });
    expect(await client.send("Review it", "review_token_123")).toEqual({
      id: "delivery-1",
      duplicate: true
    });
    expect(await client.incoming("2026-07-25T12:00:00.000Z")).toHaveLength(1);

    const unauthorized = await fetch(`${server.url}/health`, {
      headers: { Authorization: "Bearer wrong-token-that-is-long-enough" }
    });
    expect(unauthorized.status).toBe(401);
  });

  test("does not expose adapter internals in relay errors", async () => {
    const adapter = new ContractAdapter();
    adapter.fail = true;
    const server = await startRelayServer({ adapter, token, recipient, port: 0 });
    servers.push(server);
    const response = await fetch(`${server.url}/health`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(body).not.toContain("database");
    expect(body).toContain("Relay operation failed");
  });

  test("rejects oversized relay responses before returning adapter data", async () => {
    const adapter = new ContractAdapter();
    adapter.replies = Array.from({ length: 100 }, (_, index) => ({
      id: `reply-${index}`,
      text: "review",
      sender: `+1${"5".repeat(25_000)}`,
      receivedAt: "2026-07-25T12:01:00.000Z"
    }));
    const server = await startRelayServer({ adapter, token, recipient, port: 0 });
    servers.push(server);
    const response = await fetch(`${server.url}/v1/replies`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Relay response exceeded the safety limit"
    });
  });
});

describe("approval decisions", () => {
  test("requires the exact sender, timestamp, homepage ID, and nonce", () => {
    const requestedAt = "2026-07-25T12:00:00.000Z";
    const base: RelayMessage = {
      id: "reply-1",
      sender: recipient,
      text: "YES homepage-001 nonce123 — make this preview the Local site's homepage",
      receivedAt: "2026-07-25T12:01:00.000Z"
    };
    expect(parseApproval(base, "homepage-001", "nonce123", recipient, requestedAt)).toBe("approved");
    expect(parseApproval({ ...base, sender: "+15550000000" }, "homepage-001", "nonce123", recipient, requestedAt)).toBeUndefined();
    expect(parseApproval({ ...base, receivedAt: requestedAt }, "homepage-001", "nonce123", recipient, requestedAt)).toBeUndefined();
    expect(parseApproval({ ...base, text: base.text.replace("nonce123", "wrong") }, "homepage-001", "nonce123", recipient, requestedAt)).toBeUndefined();
    expect(parseApproval({ ...base, text: `${base.text}\n` }, "homepage-001", "nonce123", recipient, requestedAt)).toBeUndefined();
  });

  test("can omit the Live Link password from the approval message", () => {
    const text = approvalText("homepage-001", "nonce123", "https://preview.example.test", "preview-user", undefined);
    expect(text).toContain("password manager");
    expect(text).not.toContain("preview-password");
    expect(text).toContain("YES homepage-001 nonce123");
  });
});
