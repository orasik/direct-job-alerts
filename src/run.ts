import config from "../config.json";
import type { Env } from "./index";
import { allAtsTargets } from "./ats";
import { serperSearch } from "./serper";
import { postWebhook } from "./webhook";
import { toCsv } from "./csv";
import { DATE_RANGE_MAP, type AppConfig, type Job } from "./types";

/** How long a job URL stays "seen" in KV before it can be re-notified. */
const SEEN_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days
/** Max jobs per webhook POST (keeps payloads small + allows partial progress). */
const WEBHOOK_CHUNK = 100;
/** How many Serper searches to run concurrently. */
const SEARCH_CONCURRENCY = 5;

/** Summary returned from a run (useful for the manual /run endpoint). */
export interface RunSummary {
  searches: number;
  results: number;
  unique: number;
  new: number;
  sent: number;
}

/**
 * Result of a run. `csv` is populated only when WEBHOOK_OR_CSV=csv and the
 * caller asked for it (the HTTP /run handler turns it into a file download).
 */
export interface RunResult extends RunSummary {
  csv?: string;
}

/** Options controlling how a run delivers its results. */
export interface RunOptions {
  /**
   * Whether the caller can hand a generated CSV back to the user (true for the
   * HTTP /run endpoint, false for the cron `scheduled` path which has nowhere
   * to write a file).
   */
  canDeliverCsv?: boolean;
}

interface SearchTask {
  country: string;
  query: string;
  range: string;
  atsName: string;
  atsHost: string;
}

/**
 * Main entry point: builds every (country × query × date_range × ATS)
 * combination, searches Serper, dedupes against KV, and webhooks new jobs.
 */
export async function runSearch(env: Env, opts: RunOptions = {}): Promise<RunResult> {
  const cfg = config as AppConfig;
  const tasks = buildTasks(cfg);

  // 1. Fan out the searches with bounded concurrency.
  const collected: Job[] = [];
  await pool(tasks, SEARCH_CONCURRENCY, async (task) => {
    const code = DATE_RANGE_MAP[task.range];
    if (code === undefined) {
      console.warn(`Unknown date_range "${task.range}" — skipping`);
      return;
    }
    const tbs = code ? `qdr:${code}` : undefined;
    // Query is used verbatim — the user controls quoting in config.json.
    const q = `site:${task.atsHost} ${task.query}`.trim();

    try {
      const resp = await serperSearch(env.SERPER_API_KEY, q, task.country, tbs);
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
      console.error(`Search failed [${task.country}] ${q}:`, err);
    }
  });

  // 2. Dedupe within this run (same URL may match multiple queries).
  const unique = dedupeByUrl(collected);

  // 3. Drop anything we've already sent in a previous run.
  const fresh: { job: Job; key: string }[] = [];
  for (const job of unique) {
    const key = await hashUrl(job.url);
    const seen = await env.SEEN_JOBS.get(key);
    if (!seen) fresh.push({ job, key });
  }

  // 4. Deliver the new jobs — either to a CSV file (WEBHOOK_OR_CSV=csv,
  //    recommended for local runs) or to the webhook (the default).
  const mode = (env.WEBHOOK_OR_CSV ?? "webhook").trim().toLowerCase();
  let sent = 0;
  let csv: string | undefined;

  if (mode === "csv") {
    if (opts.canDeliverCsv) {
      // The HTTP /run handler returns this string as a downloadable file.
      csv = toCsv(fresh.map((c) => c.job));
      await Promise.all(
        fresh.map((c) => env.SEEN_JOBS.put(c.key, "1", { expirationTtl: SEEN_TTL_SECONDS })),
      );
      sent = fresh.length;
    } else {
      // The cron path has nowhere to write a file; skip without marking seen
      // so the jobs can still be exported on a later manual /run.
      console.warn(
        `WEBHOOK_OR_CSV=csv: found ${fresh.length} new job(s) but a scheduled/cron ` +
          "run cannot write a file (sent=0). Trigger GET /run to download the CSV. " +
          "Jobs were left unmarked so nothing is lost.",
      );
    }
  } else {
    // Webhook the new jobs in chunks, marking each chunk seen on success.
    if (!env.WEBHOOK_URL) {
      throw new Error("WEBHOOK_URL is not set (required unless WEBHOOK_OR_CSV=csv).");
    }
    for (let i = 0; i < fresh.length; i += WEBHOOK_CHUNK) {
      const chunk = fresh.slice(i, i + WEBHOOK_CHUNK);
      await postWebhook(
        env.WEBHOOK_URL,
        chunk.map((c) => c.job),
      );
      await Promise.all(
        chunk.map((c) => env.SEEN_JOBS.put(c.key, "1", { expirationTtl: SEEN_TTL_SECONDS })),
      );
      sent += chunk.length;
    }
  }

  const summary: RunSummary = {
    searches: tasks.length,
    results: collected.length,
    unique: unique.length,
    new: fresh.length,
    sent,
  };
  console.log("Run complete:", JSON.stringify(summary));
  return { ...summary, csv };
}

/** Build the cartesian product of config dimensions × every ATS in ats.json. */
function buildTasks(cfg: AppConfig): SearchTask[] {
  const tasks: SearchTask[] = [];
  const targets = allAtsTargets();
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

/** Keep only the first job per unique URL. */
function dedupeByUrl(jobs: Job[]): Job[] {
  const map = new Map<string, Job>();
  for (const job of jobs) {
    if (!map.has(job.url)) map.set(job.url, job);
  }
  return [...map.values()];
}

/** Stable SHA-256 hex key for a URL (safe for KV key length/charset). */
async function hashUrl(url: string): Promise<string> {
  const data = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Run `worker` over `items` with at most `size` in flight at once. */
async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}
