// Standalone local CSV export — runs the same Serper search as the Worker and
// writes the results straight to a file on disk. No dev server, no webhook.
//
//   npm run export:csv            -> writes ./jobs.csv
//   npm run export:csv out.csv    -> writes ./out.csv
//
// Reads SERPER_API_KEY from the environment, falling back to .dev.vars.
// Source of truth for the Worker path lives in src/* — keep CSV/Serper logic
// here in sync with src/csv.ts and src/serper.ts if you change them.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Maps config.json date_range values to Google's qdr: time-filter codes. */
const DATE_RANGE_MAP = {
  anytime: null,
  past_hour: "h",
  past_day: "d",
  past_week: "w",
  past_month: "m",
  past_year: "y",
};

const COLUMNS = ["title", "url", "snippet", "date", "query", "ats", "country"];
const SEARCH_CONCURRENCY = 5;

function readJson(name) {
  return JSON.parse(readFileSync(join(ROOT, name), "utf8"));
}

/** SERPER_API_KEY from the env, else parsed out of .dev.vars. */
function serperApiKey() {
  if (process.env.SERPER_API_KEY) return process.env.SERPER_API_KEY;
  let raw = "";
  try {
    raw = readFileSync(join(ROOT, ".dev.vars"), "utf8");
  } catch {
    /* no .dev.vars — fall through to the error below */
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*SERPER_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1];
  }
  throw new Error("SERPER_API_KEY not set (export it, or add it to .dev.vars).");
}

/** One Google search via Serper.dev. */
async function serperSearch(apiKey, q, gl, tbs) {
  const body = { q, gl };
  if (tbs) body.tbs = tbs;
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Serper request failed (${res.status}): ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

/** Cartesian product of config dimensions × every ATS host. */
function buildTasks(cfg, atsMap) {
  const seenHost = new Set();
  const targets = [];
  for (const [name, host] of Object.entries(atsMap)) {
    if (seenHost.has(host)) continue;
    seenHost.add(host);
    targets.push({ name, host });
  }
  const tasks = [];
  for (const country of cfg.countries) {
    for (const query of cfg.queries) {
      for (const range of cfg.date_range) {
        for (const { name, host } of targets) {
          tasks.push({ country, query, range, atsName: name, atsHost: host });
        }
      }
    }
  }
  return tasks;
}

/** Run `worker` over `items` with at most `size` in flight. */
async function pool(items, size, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

/** Escape one CSV field per RFC 4180. */
function escapeCsv(value) {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render jobs as an RFC 4180 CSV string with a header row. */
function toCsv(jobs) {
  const rows = [COLUMNS.join(",")];
  for (const job of jobs) rows.push(COLUMNS.map((c) => escapeCsv(job[c])).join(","));
  return rows.join("\r\n") + "\r\n";
}

async function main() {
  const outPath = resolve(process.cwd(), process.argv[2] ?? "jobs.csv");
  const apiKey = serperApiKey();
  const cfg = readJson("config.json");
  const atsMap = readJson("ats.json");
  const tasks = buildTasks(cfg, atsMap);

  const collected = [];
  await pool(tasks, SEARCH_CONCURRENCY, async (task) => {
    const code = DATE_RANGE_MAP[task.range];
    if (code === undefined) {
      console.warn(`Unknown date_range "${task.range}" — skipping`);
      return;
    }
    const tbs = code ? `qdr:${code}` : undefined;
    const q = `site:${task.atsHost} ${task.query}`.trim();
    try {
      const resp = await serperSearch(apiKey, q, task.country, tbs);
      for (const hit of resp.organic ?? []) {
        if (!hit.link) continue;
        collected.push({
          title: hit.title ?? "",
          url: hit.link,
          snippet: hit.snippet ?? "",
          date: hit.date ?? null,
          query: task.query,
          ats: task.atsName,
          country: task.country,
        });
      }
    } catch (err) {
      console.error(`Search failed [${task.country}] ${q}:`, err.message);
    }
  });

  // Dedupe by URL (same listing can match multiple queries).
  const byUrl = new Map();
  for (const job of collected) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
  const jobs = [...byUrl.values()];

  if (jobs.length === 0) {
    console.log("No jobs found — nothing written.");
    return;
  }

  writeFileSync(outPath, toCsv(jobs), "utf8");
  console.log(`Wrote ${jobs.length} job(s) to ${outPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
