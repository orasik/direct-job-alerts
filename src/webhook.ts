import type { Job } from "./types";

/**
 * POST a batch of jobs to the configured webhook URL.
 * Throws on a non-2xx response so the caller can avoid marking the jobs as
 * "seen" (they'll be retried on the next run).
 */
export async function postWebhook(webhookUrl: string, jobs: Job[]): Promise<void> {
  const payload = {
    source: "directjobs-cron",
    timestamp: new Date().toISOString(),
    count: jobs.length,
    jobs,
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook delivery failed (${res.status}): ${text}`);
  }
}
