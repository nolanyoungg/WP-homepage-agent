import type { RelayMessage } from "../domain/types.js";

export function approvalText(
  homepageId: string,
  nonce: string,
  liveUrl: string,
  username: string,
  password: string | undefined
): string {
  const login = password
    ? `Login:\nUsername: ${username}\nPassword: ${password}`
    : `Login:\nUsername: ${username}\nUse the Live Link password stored in your password manager.`;
  return `Homepage #${homepageId} is ready for review.\n\nPreview:\n${liveUrl}\n\n${login}\n\nReply exactly:\nYES ${homepageId} ${nonce} — make this preview the Local site's homepage\nNO ${homepageId} ${nonce} — reject it and leave the current Local homepage unchanged`;
}

export function parseApproval(
  message: RelayMessage,
  homepageId: string,
  nonce: string,
  expectedSender: string,
  requestedAt: string
): "approved" | "rejected" | undefined {
  const receivedTime = Date.parse(message.receivedAt);
  const requestedTime = Date.parse(requestedAt);
  if (
    message.sender !== expectedSender
    || !Number.isFinite(receivedTime)
    || !Number.isFinite(requestedTime)
    || receivedTime <= requestedTime
  ) {
    return undefined;
  }
  const yes = `YES ${homepageId} ${nonce} — make this preview the Local site's homepage`;
  const no = `NO ${homepageId} ${nonce} — reject it and leave the current Local homepage unchanged`;
  if (message.text === yes) return "approved";
  if (message.text === no) return "rejected";
  return undefined;
}
