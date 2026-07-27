import { afterEach, describe, expect, test } from "vitest";
import { runProcess } from "../src/runtime/process.js";

const secretName = "WP_HOMEPAGE_AGENT_TEST_SECRET";

afterEach(() => {
  delete process.env[secretName];
});

describe("subprocess safety", () => {
  test("does not inherit credential-like environment variables", async () => {
    process.env[secretName] = "must-not-reach-child";
    const result = await runProcess(
      process.execPath,
      ["-e", `process.stdout.write(process.env.${secretName} ?? "absent")`],
      { timeoutMs: 5_000, maxOutputBytes: 1_000 }
    );
    expect(result.stdout).toBe("absent");
  });
});
