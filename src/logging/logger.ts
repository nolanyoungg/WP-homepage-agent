import fs from "node:fs/promises";
import path from "node:path";

const SECRET_KEYS = /password|token|authorization|credential|secret/i;

export function redact(value: unknown, secrets: string[] = []): unknown {
  const known = secrets.filter((secret) => secret.length >= 4);
  if (typeof value === "string") {
    let result = value;
    for (const secret of known) result = result.split(secret).join("[REDACTED]");
    return result;
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, known));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEYS.test(key) ? "[REDACTED]" : redact(entry, known)
    ]));
  }
  return value;
}

export interface EventLogger {
  readonly runId: string;
  write(event: string, fields?: Record<string, unknown>): Promise<void>;
}

export class SafeRunLogger implements EventLogger {
  readonly file: string;

  constructor(
    readonly runId: string,
    logsDirectory: string,
    private readonly secrets: string[] = []
  ) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.file = path.join(logsDirectory, `${timestamp}-${runId}.jsonl`);
  }

  async write(event: string, fields: Record<string, unknown> = {}): Promise<void> {
    const record = redact({
      timestamp: new Date().toISOString(),
      run_id: this.runId,
      event,
      ...fields
    }, this.secrets);
    const line = JSON.stringify(record);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.appendFile(this.file, `${line}\n`, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`${line}\n`);
  }
}
