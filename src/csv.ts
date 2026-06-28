import type { Job } from "./types";

/** Columns emitted in the CSV, in order. */
const COLUMNS: (keyof Job)[] = ["title", "url", "snippet", "date", "query", "ats", "country"];

/**
 * Escape a single CSV field per RFC 4180: wrap in double quotes (and double any
 * embedded quotes) when the value contains a comma, quote, or newline.
 */
function escapeCsv(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render jobs as an RFC 4180 CSV string with a header row. */
export function toCsv(jobs: Job[]): string {
  const rows = [COLUMNS.join(",")];
  for (const job of jobs) {
    rows.push(COLUMNS.map((c) => escapeCsv(job[c])).join(","));
  }
  // Trailing newline so the file ends cleanly.
  return rows.join("\r\n") + "\r\n";
}
