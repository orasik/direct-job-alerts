import { runSearch } from "./run";

export interface Env {
  /** Serper.dev API key. Set with `wrangler secret put SERPER_API_KEY`. */
  SERPER_API_KEY: string;
  /** Destination webhook URL. Set with `wrangler secret put WEBHOOK_URL`. Required unless WEBHOOK_OR_CSV=csv. */
  WEBHOOK_URL?: string;
  /**
   * Where results go: "webhook" (default) POSTs to WEBHOOK_URL; "csv" returns
   * the results as a downloadable CSV from `GET /run` (recommended for local runs).
   */
  WEBHOOK_OR_CSV?: string;
  /** KV namespace used to remember already-notified job URLs. */
  SEEN_JOBS: KVNamespace;
}

export default {
  /** Cron trigger — runs on the schedule defined in wrangler.jsonc. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSearch(env));
  },

  /** HTTP entry — handy for manually triggering a run while testing. */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/run") {
      const { csv, ...summary } = await runSearch(env, { canDeliverCsv: true });
      // CSV mode: return the results as a downloadable file (saved locally by
      // the browser, or via `curl .../run -o jobs.csv`).
      if (csv !== undefined) {
        // Nothing new — don't force a junk/empty download; say so plainly.
        if (summary.new === 0) {
          return new Response("No new jobs found.\n", {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "X-Run-Summary": JSON.stringify(summary),
            },
          });
        }
        const filename = `directjobs-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            // Run counts, since the body is the CSV rather than the JSON summary.
            "X-Run-Summary": JSON.stringify(summary),
          },
        });
      }
      return Response.json(summary);
    }
    return new Response("directjobs-cron is alive. Hit /run to trigger a search manually.\n", {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
