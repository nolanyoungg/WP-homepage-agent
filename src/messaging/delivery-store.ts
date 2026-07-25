import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../domain/manifest.js";
import { assertPathInside, assertSafeHomepageId } from "../validation/paths.js";

const schema = z.object({
  schema_version: z.literal(1),
  homepage_id: z.string(),
  idempotency_key: z.string(),
  attempt_count: z.number().int().nonnegative(),
  first_attempt_at: z.string().datetime(),
  last_attempt_at: z.string().datetime(),
  status: z.enum(["attempting", "delivered", "failed"]),
  delivery_id: z.string().optional(),
  delivered_at: z.string().datetime().optional(),
  duplicate: z.boolean().optional(),
  last_error: z.string().optional()
});

export type ReviewDeliveryRecord = z.infer<typeof schema>;

export class ReviewDeliveryStore {
  constructor(private readonly dataRoot: string) {}

  private file(homepageId: string): string {
    assertSafeHomepageId(homepageId);
    const file = path.resolve(this.dataRoot, homepageId, "review-delivery.json");
    assertPathInside(this.dataRoot, file);
    return file;
  }

  async read(homepageId: string): Promise<ReviewDeliveryRecord | undefined> {
    try {
      return schema.parse(JSON.parse(await fs.readFile(this.file(homepageId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async begin(homepageId: string, idempotencyKey: string): Promise<ReviewDeliveryRecord> {
    const existing = await this.read(homepageId);
    if (existing && existing.idempotency_key !== idempotencyKey) {
      throw new Error("Review delivery idempotency key changed for the same homepage");
    }
    const now = new Date().toISOString();
    const record: ReviewDeliveryRecord = {
      schema_version: 1,
      homepage_id: homepageId,
      idempotency_key: idempotencyKey,
      attempt_count: (existing?.attempt_count ?? 0) + 1,
      first_attempt_at: existing?.first_attempt_at ?? now,
      last_attempt_at: now,
      status: "attempting"
    };
    await writeJsonAtomic(this.file(homepageId), record);
    return record;
  }

  async succeeded(
    record: ReviewDeliveryRecord,
    delivery: { id: string; duplicate: boolean }
  ): Promise<ReviewDeliveryRecord> {
    const completed: ReviewDeliveryRecord = {
      ...record,
      status: "delivered",
      delivery_id: delivery.id,
      delivered_at: new Date().toISOString(),
      duplicate: delivery.duplicate
    };
    await writeJsonAtomic(this.file(record.homepage_id), completed);
    return completed;
  }

  async failed(record: ReviewDeliveryRecord, message: string): Promise<ReviewDeliveryRecord> {
    const failed: ReviewDeliveryRecord = {
      ...record,
      status: "failed",
      last_error: message.slice(0, 2_000)
    };
    await writeJsonAtomic(this.file(record.homepage_id), failed);
    return failed;
  }
}
