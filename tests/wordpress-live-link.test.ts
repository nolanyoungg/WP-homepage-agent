import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildLivePreviewUrl,
  confirmUrl
} from "../src/wordpress/live-link.js";
import { firstNumericWpId, numericWpIds } from "../src/wordpress/client.js";

const servers: Server[] = [];

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{ server: Server; url: string; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  servers.push(server);
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    port: address.port
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  ));
});

describe("WordPress and Live Link URL checks", () => {
  test("parses only complete numeric WP-CLI output lines", () => {
    const output = "PHP Warning on line 128\n22\n";
    expect(numericWpIds(output)).toEqual(["22"]);
    expect(firstNumericWpId(output)).toBe("22");
    expect(firstNumericWpId("Warning code 128 with no Page ID")).toBeUndefined();
  });

  test("preserves only the Local preview path on the configured Live Link origin", () => {
    expect(buildLivePreviewUrl(
      "https://preview.example.test",
      "http://local.example.test/careful-landscaping/?preview=true#ignored"
    )).toBe("https://preview.example.test/careful-landscaping/?preview=true");
  });

  test("accepts a successful local HTTP render", async () => {
    const { url } = await listen((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("ok");
    });
    await expect(confirmUrl(url)).resolves.toBeUndefined();
  });

  test("rejects redirects to another host", async () => {
    const { url, port } = await listen((_request, response) => {
      response.writeHead(302, { Location: `http://localhost:${port}/elsewhere` });
      response.end();
    });
    await expect(confirmUrl(url)).rejects.toThrow(/left the configured host/);
  });

  test("does not forward Live Link authorization to another origin", async () => {
    const { url, port } = await listen((_request, response) => {
      response.writeHead(302, { Location: `http://127.0.0.1:${port + 1}/elsewhere` });
      response.end();
    });
    await expect(confirmUrl(url, "Basic private-value")).rejects.toThrow(/left the configured origin/);
  });
});
