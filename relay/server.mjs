import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
if (process.platform !== "darwin") throw new Error("The iMessage relay runs only on macOS");
const port = Number(process.env.RELAY_PORT || 8787);
const host = process.env.RELAY_HOST || "0.0.0.0";
const token = process.env.IMESSAGE_RELAY_TOKEN;
if (!token || token.length < 24) throw new Error("IMESSAGE_RELAY_TOKEN must contain at least 24 characters");

function authorized(request) {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  const expected = Buffer.from(token); const actual = Buffer.from(supplied);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}
async function requestBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_000) throw new Error("Request too large");
  }
  return JSON.parse(body || "{}");
}
function validAddress(value) { return typeof value === "string" && value.length <= 254 && /^[+a-zA-Z0-9@._()-]+$/.test(value); }
function sqlLiteral(value) { return `'${value.replaceAll("'", "''")}'`; }

const sendScript = `on run argv
  set targetAddress to item 1 of argv
  set messageBody to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy targetAddress of targetService
    send messageBody to targetBuddy
  end tell
end run`;

async function sendMessage(recipient, body) {
  if (!validAddress(recipient) || typeof body !== "string" || !body || body.length > 10_000) throw new Error("Invalid message request");
  await exec("osascript", ["-e", sendScript, recipient, body], { timeout: 30_000, windowsHide: true });
  return crypto.randomUUID();
}

async function readMessages(sender, since) {
  if (!validAddress(sender) || Number.isNaN(Date.parse(since))) throw new Error("Invalid message query");
  const appleEpochMs = Date.UTC(2001, 0, 1);
  const sinceNanoseconds = BigInt(Date.parse(since) - appleEpochMs) * 1_000_000n;
  const query = `SELECT m.ROWID, h.id, replace(replace(coalesce(m.text,''), char(10), '\\n'), char(13), ''), m.date FROM message m JOIN handle h ON h.ROWID=m.handle_id WHERE m.is_from_me=0 AND h.id=${sqlLiteral(sender)} AND m.date>${sinceNanoseconds} ORDER BY m.date ASC;`;
  const database = path.join(os.homedir(), "Library", "Messages", "chat.db");
  const { stdout } = await exec("sqlite3", ["-separator", "\t", database, query], { timeout: 15_000, maxBuffer: 2_000_000 });
  return stdout.trim().split("\n").filter(Boolean).map((line) => {
    const [id, messageSender, escapedBody, rawDate] = line.split("\t");
    const receivedAt = new Date(appleEpochMs + Number(BigInt(rawDate) / 1_000_000n)).toISOString();
    return { id, sender: messageSender, body: (escapedBody || "").replaceAll("\\n", "\n"), receivedAt };
  });
}

http.createServer(async (request, response) => {
  try {
    if (!authorized(request)) return json(response, 401, { error: "unauthorized" });
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, platform: process.platform });
    if (request.method === "POST" && url.pathname === "/v1/messages") {
      const body = await requestBody(request);
      const id = await sendMessage(body.recipient, body.body);
      return json(response, 201, { id });
    }
    if (request.method === "GET" && url.pathname === "/v1/messages") {
      return json(response, 200, { messages: await readMessages(url.searchParams.get("sender") || "", url.searchParams.get("since") || "") });
    }
    return json(response, 404, { error: "not_found" });
  } catch (error) {
    process.stderr.write(`${new Date().toISOString()} relay request failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    return json(response, 500, { error: "relay_failure" });
  }
}).listen(port, host, () => process.stdout.write(`iMessage relay listening on ${host}:${port}\n`));

