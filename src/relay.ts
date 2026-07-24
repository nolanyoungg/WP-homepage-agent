import { z } from "zod";
import type { RelayMessage } from "./types.js";

const relayResponse = z.object({ id: z.string().min(1) });
const relayMessages = z.object({ messages: z.array(z.object({ id: z.string(), sender: z.string(), body: z.string(), receivedAt: z.string().datetime() })) });

export function approvalText(homepageId: string, liveUrl: string, username: string, password: string): string {
  return `Homepage #${homepageId} is ready for review.\n\nPreview:\n${liveUrl}\n\nLogin:\nUsername: ${username}\nPassword: ${password}\n\nReply exactly:\nYES ${homepageId} — make this preview the Local site's homepage\nNO ${homepageId} — reject it and leave the current Local homepage unchanged`;
}
export function parseApproval(message: RelayMessage, homepageId: string, expectedSender: string, requestedAt: string): "approved" | "rejected" | undefined {
  const receivedTime = Date.parse(message.receivedAt);
  const requestedTime = Date.parse(requestedAt);
  if (message.sender !== expectedSender || !Number.isFinite(receivedTime) || !Number.isFinite(requestedTime) || receivedTime <= requestedTime) return undefined;
  const yes = `YES ${homepageId} — make this preview the Local site's homepage`;
  const no = `NO ${homepageId} — reject it and leave the current Local homepage unchanged`;
  if (message.body.trim() === yes) return "approved";
  if (message.body.trim() === no) return "rejected";
  return undefined;
}
export class IMessageRelayClient {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly recipient: string) {}
  private headers(): Record<string, string> { return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }; }
  async healthCheck(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/health`, { headers: this.headers(), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`iMessage relay health check failed with HTTP ${response.status}`);
  }
  async send(body: string, reviewToken: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, { method: "POST", headers: this.headers(), signal: AbortSignal.timeout(15_000), body: JSON.stringify({ recipient: this.recipient, body, reviewToken }) });
    if (!response.ok) throw new Error(`iMessage relay delivery failed with HTTP ${response.status}`);
    return relayResponse.parse(await response.json()).id;
  }
  async incoming(since: string): Promise<RelayMessage[]> {
    const url = new URL(`${this.baseUrl}/v1/messages`); url.searchParams.set("sender", this.recipient); url.searchParams.set("since", since);
    const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`iMessage relay read failed with HTTP ${response.status}`);
    return relayMessages.parse(await response.json()).messages;
  }
}

