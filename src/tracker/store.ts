import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  HOMEPAGE_STATES,
  TRACKER_COLUMNS,
  TRACKER_SHEET,
  type HomepageState
} from "../domain/constants.js";
import type { TrackerRow } from "../domain/types.js";
import { assertSafeHomepageId } from "../validation/paths.js";

export const TRANSITIONS: Record<HomepageState, readonly HomepageState[]> = {
  pending: ["planning"],
  planning: ["generating", "error", "pending"],
  generating: ["validating", "error", "pending"],
  validating: ["awaiting_review", "error", "blocked_review_delivery", "pending"],
  awaiting_review: ["approved", "rejected", "blocked_review_delivery", "error"],
  approved: ["installing", "error"],
  installing: ["installed", "error"],
  installed: [],
  rejected: [],
  error: ["pending", "planning", "generating", "validating", "installing", "blocked_review_delivery"],
  blocked_review_delivery: ["awaiting_review", "rejected", "error"]
};

export function assertTransition(from: HomepageState, to: HomepageState): void {
  if (!TRANSITIONS[from].includes(to)) throw new Error(`Invalid tracker transition: ${from} -> ${to}`);
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "text" in value) return String(value.text);
  if (typeof value === "object" && "result" in value) return String(value.result ?? "");
  return String(value);
}

function validateRow(row: TrackerRow, rowNumber: number): void {
  assertSafeHomepageId(row.homepage_id);
  if (!row.homepage_idea.trim()) throw new Error(`Homepage idea is required in row ${rowNumber}`);
  if (row.homepage_idea.length > 4_000) throw new Error(`Homepage idea exceeds 4,000 characters in row ${rowNumber}`);
}

export class TrackerStore {
  constructor(
    private readonly filePath: string,
    private readonly staleLockMs = 900_000
  ) {}

  private lockPath(): string {
    return `${this.filePath}.lock`;
  }

  private async removeStaleLock(lockPath: string): Promise<boolean> {
    try {
      const details = await fs.stat(lockPath);
      if (Date.now() - details.mtimeMs <= this.staleLockMs) return false;
      try {
        const metadata = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
          pid?: unknown;
          hostname?: unknown;
        };
        if (
          metadata.hostname === os.hostname()
          && typeof metadata.pid === "number"
          && Number.isInteger(metadata.pid)
          && metadata.pid > 0
        ) {
          try {
            process.kill(metadata.pid, 0);
            return false;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
          }
        }
      } catch {
        // Invalid metadata is treated as stale only after the configured age.
      }
      await fs.rm(lockPath, { force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async acquireLock(lockPath = this.lockPath()): Promise<fs.FileHandle> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const handle = await fs.open(lockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          hostname: os.hostname(),
          acquired_at: new Date().toISOString()
        }));
        return handle;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await this.removeStaleLock(lockPath)) continue;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error("Tracker is locked by another worker");
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const lockPath = this.lockPath();
    const handle = await this.acquireLock(lockPath);
    try { return await work(); }
    finally {
      await handle.close();
      await fs.rm(lockPath, { force: true });
    }
  }

  async withWorkerLease<T>(work: () => Promise<T>): Promise<T> {
    const lockPath = `${this.filePath}.worker.lock`;
    const handle = await this.acquireLock(lockPath);
    const heartbeat = setInterval(() => {
      const now = new Date();
      void fs.utimes(lockPath, now, now).catch(() => undefined);
    }, Math.max(1_000, Math.min(Math.floor(this.staleLockMs / 3), 30_000)));
    heartbeat.unref();
    try { return await work(); }
    finally {
      clearInterval(heartbeat);
      await handle.close();
      await fs.rm(lockPath, { force: true });
    }
  }

  private async load(): Promise<{ workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet; rows: TrackerRow[] }> {
    const details = await fs.stat(this.filePath);
    if (!details.isFile()) throw new Error("Tracker path is not a file");
    if (details.size > 10 * 1024 * 1024) throw new Error("Tracker workbook exceeds the 10 MiB safety limit");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(this.filePath);
    const sheet = workbook.getWorksheet(TRACKER_SHEET);
    if (!sheet) throw new Error(`Tracker worksheet must be named '${TRACKER_SHEET}'`);
    if (sheet.rowCount > 1_001) throw new Error("Tracker workbook exceeds the 1,000-row safety limit");
    const headers = TRACKER_COLUMNS.map((_, index) => cellText(sheet.getCell(1, index + 1).value));
    if (headers.join("|") !== TRACKER_COLUMNS.join("|")) throw new Error("Tracker columns do not match the required schema");
    const rows: TrackerRow[] = [];
    const ids = new Map<string, number>();
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = this.rowFromSheet(sheet, rowNumber);
      if (!row.homepage_id) continue;
      validateRow(row, rowNumber);
      const previous = ids.get(row.homepage_id);
      if (previous !== undefined) {
        throw new Error(`Tracker contains duplicate homepage_id '${row.homepage_id}' in rows ${previous} and ${rowNumber}`);
      }
      ids.set(row.homepage_id, rowNumber);
      rows.push(row);
    }
    return { workbook, sheet, rows };
  }

  private rowFromSheet(sheet: ExcelJS.Worksheet, rowNumber: number): TrackerRow {
    const values = Object.fromEntries(TRACKER_COLUMNS.map((key, index) => [
      key,
      cellText(sheet.getCell(rowNumber, index + 1).value)
    ]));
    if (values.homepage_id && !HOMEPAGE_STATES.includes(values.homepage_status as HomepageState)) {
      throw new Error(`Invalid state in row ${rowNumber}: ${values.homepage_status}`);
    }
    return values as TrackerRow;
  }

  private findRowNumber(sheet: ExcelJS.Worksheet, homepageId: string): number | undefined {
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      if (cellText(sheet.getCell(row, 1).value) === homepageId) return row;
    }
    return undefined;
  }

  private async saveAtomic(workbook: ExcelJS.Workbook): Promise<void> {
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp.xlsx`;
    try {
      await workbook.xlsx.writeFile(temporary);
      const verification = new ExcelJS.Workbook();
      await verification.xlsx.readFile(temporary);
      if (!verification.getWorksheet(TRACKER_SHEET)) throw new Error("Temporary tracker validation failed");
      await fs.rename(temporary, this.filePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  async list(): Promise<TrackerRow[]> {
    return (await this.load()).rows;
  }

  async find(homepageId: string): Promise<TrackerRow | undefined> {
    assertSafeHomepageId(homepageId);
    return (await this.list()).find((row) => row.homepage_id === homepageId);
  }

  async claimPending(): Promise<TrackerRow | undefined> {
    return this.withLock(async () => {
      const { workbook, sheet, rows } = await this.load();
      const pending = rows.find((row) => row.homepage_status === "pending");
      if (!pending) return undefined;
      const rowNumber = this.findRowNumber(sheet, pending.homepage_id)!;
      const updated = {
        ...pending,
        homepage_status: "planning",
        last_error: "",
        last_updated_at: new Date().toISOString()
      } as TrackerRow;
      this.writeRow(sheet, rowNumber, updated);
      await this.saveAtomic(workbook);
      return updated;
    });
  }

  async patch(homepageId: string, patch: Partial<TrackerRow>, expectedState?: HomepageState): Promise<TrackerRow> {
    assertSafeHomepageId(homepageId);
    return this.withLock(async () => {
      const { workbook, sheet } = await this.load();
      const rowNumber = this.findRowNumber(sheet, homepageId);
      if (rowNumber === undefined) throw new Error(`Homepage row not found: ${homepageId}`);
      const current = this.rowFromSheet(sheet, rowNumber);
      if (expectedState && current.homepage_status !== expectedState) {
        throw new Error(`Row ${homepageId} is ${current.homepage_status}, expected ${expectedState}`);
      }
      const nextState = patch.homepage_status;
      if (nextState && nextState !== current.homepage_status) assertTransition(current.homepage_status, nextState);
      const updated = { ...current, ...patch, last_updated_at: new Date().toISOString() } as TrackerRow;
      validateRow(updated, rowNumber);
      this.writeRow(sheet, rowNumber, updated);
      await this.saveAtomic(workbook);
      return updated;
    });
  }

  async prepareRetry(homepageId: string): Promise<TrackerRow> {
    const current = await this.find(homepageId);
    if (!current) throw new Error(`Homepage row not found: ${homepageId}`);
    if (current.homepage_status === "blocked_review_delivery") return current;
    if (current.homepage_status !== "error") {
      throw new Error(`Homepage ${homepageId} is ${current.homepage_status}; only error or blocked_review_delivery rows can be retried`);
    }
    const target: HomepageState = current.review_status === "approved" && current.preview_page_id
      ? "installing"
      : current.manifest_path
        ? "validating"
        : current.homepage_idea
          ? "planning"
          : "pending";
    return this.patch(homepageId, { homepage_status: target, last_error: "" }, "error");
  }

  private writeRow(sheet: ExcelJS.Worksheet, row: number, value: TrackerRow): void {
    TRACKER_COLUMNS.forEach((key, index) => {
      sheet.getCell(row, index + 1).value = value[key];
    });
  }
}

export async function createStarterTracker(filePath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "wp-homepage-agent";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(TRACKER_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = TRACKER_COLUMNS.map((header) => ({
    header,
    key: header,
    width: Math.max(18, header.length + 2)
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: "A1", to: "R1" };
  sheet.addRow({ homepage_status: "pending" });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await workbook.xlsx.writeFile(filePath);
}
