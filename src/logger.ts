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
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SECRET_KEYS.test(key) ? "[REDACTED]" : redact(entry, known)]));
  }
  return value;
}

export class SafeLogger {
  constructor(private readonly secrets: string[] = []) {}
  info(message: string, data?: unknown): void { this.write("INFO", message, data); }
  error(message: string, data?: unknown): void { this.write("ERROR", message, data); }
  private write(level: string, message: string, data?: unknown): void {
    const cleanMessage = redact(message, this.secrets);
    const suffix = data === undefined ? "" : ` ${JSON.stringify(redact(data, this.secrets))}`;
    process.stdout.write(`${new Date().toISOString()} ${level} ${String(cleanMessage)}${suffix}\n`);
  }
}
