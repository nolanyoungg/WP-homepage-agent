import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { HOMEPAGE_STATES, TRACKER_COLUMNS, TRACKER_SHEET, type HomepageState } from "./constants.js";
import type { TrackerRow } from "./types.js";

const transitions: Record<HomepageState, readonly HomepageState[]> = {
  pending: ["planning"], planning: ["generating", "error"],
  generating: ["validating", "error"], validating: ["awaiting_review", "error", "blocked_review_delivery"],
  awaiting_review: ["approved", "rejected", "blocked_review_delivery", "error"],
  approved: ["installing", "error"], installing: ["installed", "error"], installed: [],
  rejected: [], error: ["pending", "validating"], blocked_review_delivery: ["awaiting_review", "rejected", "error"]
};

export function assertTransition(from: HomepageState, to: HomepageState): void {
  if (!transitions[from].includes(to)) throw new Error(`Invalid tracker transition: ${from} -> ${to}`);
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "text" in value) return String(value.text);
  if (typeof value === "object" && "result" in value) return String(value.result ?? "");
  return String(value);
}

export class TrackerStore {
  constructor(private readonly filePath: string) {}

  private async acquireLock(): Promise<fs.FileHandle> {
    const lockPath = `${this.filePath}.lock`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { return await fs.open(lockPath, "wx"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error("Tracker is locked by another worker");
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const handle = await this.acquireLock();
    try { return await work(); }
    finally { await handle.close(); await fs.rm(`${this.filePath}.lock`, { force: true }); }
  }

  private async load(): Promise<{ workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(this.filePath);
    const sheet = workbook.getWorksheet(TRACKER_SHEET);
    if (!sheet) throw new Error(`Tracker worksheet must be named '${TRACKER_SHEET}'`);
    const headers = TRACKER_COLUMNS.map((_, index) => cellText(sheet.getCell(1, index + 1).value));
    if (headers.join("|") !== TRACKER_COLUMNS.join("|")) throw new Error("Tracker columns do not match the required schema");
    return { workbook, sheet };
  }

  private rowFromSheet(sheet: ExcelJS.Worksheet, rowNumber: number): TrackerRow {
    const values = Object.fromEntries(TRACKER_COLUMNS.map((key, index) => [key, cellText(sheet.getCell(rowNumber, index + 1).value)]));
    if (!HOMEPAGE_STATES.includes(values.homepage_status as HomepageState)) throw new Error(`Invalid state in row ${rowNumber}`);
    return values as TrackerRow;
  }

  private async saveAtomic(workbook: ExcelJS.Workbook): Promise<void> {
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await workbook.xlsx.writeFile(temporary);
    await fs.rename(temporary, this.filePath);
  }

  async list(): Promise<TrackerRow[]> {
    const { sheet } = await this.load();
    const rows: TrackerRow[] = [];
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      const value = this.rowFromSheet(sheet, row);
      if (value.homepage_id) rows.push(value);
    }
    return rows;
  }

  async claimPending(): Promise<TrackerRow | undefined> {
    return this.withLock(async () => {
      const { workbook, sheet } = await this.load();
      for (let row = 2; row <= sheet.rowCount; row += 1) {
        const value = this.rowFromSheet(sheet, row);
        if (value.homepage_id && value.homepage_status === "pending") {
          value.homepage_status = "planning";
          value.last_error = "";
          value.last_updated_at = new Date().toISOString();
          this.writeRow(sheet, row, value);
          await this.saveAtomic(workbook);
          return value;
        }
      }
      return undefined;
    });
  }

  async patch(homepageId: string, patch: Partial<TrackerRow>, expectedState?: HomepageState): Promise<TrackerRow> {
    return this.withLock(async () => {
      const { workbook, sheet } = await this.load();
      for (let row = 2; row <= sheet.rowCount; row += 1) {
        const current = this.rowFromSheet(sheet, row);
        if (current.homepage_id !== homepageId) continue;
        if (expectedState && current.homepage_status !== expectedState) throw new Error(`Row ${homepageId} is ${current.homepage_status}, expected ${expectedState}`);
        const nextState = patch.homepage_status;
        if (nextState && nextState !== current.homepage_status) assertTransition(current.homepage_status, nextState);
        const updated = { ...current, ...patch, last_updated_at: new Date().toISOString() } as TrackerRow;
        this.writeRow(sheet, row, updated);
        await this.saveAtomic(workbook);
        return updated;
      }
      throw new Error(`Homepage row not found: ${homepageId}`);
    });
  }

  private writeRow(sheet: ExcelJS.Worksheet, row: number, value: TrackerRow): void {
    TRACKER_COLUMNS.forEach((key, index) => { sheet.getCell(row, index + 1).value = value[key]; });
  }
}

export async function createStarterTracker(filePath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "wp-homepage-agent";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(TRACKER_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = TRACKER_COLUMNS.map((header) => ({ header, key: header, width: Math.max(18, header.length + 2) }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: "A1", to: "R1" };
  sheet.addRow({ homepage_status: "pending" });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await workbook.xlsx.writeFile(filePath);
}

