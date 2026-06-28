import { runSearch } from "./run";

export interface Env {
  /** Serper.dev API key. Set with `wrangler secret put SERPER_API_KEY`. */
  SERPER_API_KEY: string;
  /** Destination webhook URL. Set with `wrangler secret put WEBHOOK_URL`. */
  WEBHOOK_URL: string;
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
      const summary = await runSearch(env);
      return Response.json(summary);
    }
    return new Response("directjobs-cron is alive. Hit /run to trigger a search manually.\n", {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
