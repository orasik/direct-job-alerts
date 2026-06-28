# Direct Job Alerts

<p style="text-align: center"><img width="592" height="562" alt="Direct Job Alerts" src="https://github.com/user-attachments/assets/dae5cc84-2ff7-4d2c-9afd-d620d2442d36" /></p>

A [Cloudflare Worker](https://developers.cloudflare.com/workers/) cron job that searches Google (via the [Serper.dev](https://serper.dev) API) for jobs posted on ATS (Applicant Tracking System) sites and sends new results to a webhook. Runs **once every 24 hours**. (you can change to run hourly if you want)

## Cost of running
Serper.dev has a generous *2,500* free credit. If you search for 5 queries in one country, each run will cost:
5 queries x 19 Ats = 95 credit.

If you run the cron once a day, that's enough for almost a month daily alert for free.

CloudFlare cost is FREE too.

## How it works

1. On its cron schedule the worker reads `config.json`.
2. It builds the cartesian product of **countries × queries × date_range**, and runs each one against **every ATS in `ats.json`** — one Serper search per combination, e.g. `site:myworkdayjobs.com "Outside IR35"` with `gl=gb` and `tbs=qdr:d`.
3. Organic results are collected, de-duplicated by URL, and checked against a Cloudflare KV store so jobs seen in a previous run are skipped.
4. New jobs are delivered — either POSTed to your webhook (in batches of 100) or exported as a CSV file — and then marked as seen in KV. The destination is chosen by the `WEBHOOK_OR_CSV` env variable (see [Output](#output)).

## Configuration — `config.json`

Each key is an array of strings that you can customise for your search:

| Key          | Meaning                                  | Example                                              |
| ------------ | ---------------------------------------- | ---------------------------------------------------- |
| `countries`  | Google country codes (`gl`)              | `["gb", "us"]`                                       |
| `queries`    | Search terms (see quoting below)         | `["\"Outside IR35\"", "Senior Java Engineer"]`       |
| `date_range` | Time filters (see below)                 | `["past_day"]`                                       |

Every search runs against **all** ATS sites listed in **`ats.json`** (a friendly
name → hostname map). Add or remove providers by editing `ats.json` and
redeploying — no code change needed. Duplicate hostnames are de-duplicated
automatically. The list currently includes Ashby, Workable, Workday,
Greenhouse, Lever, SmartRecruiters, and more — see `ats.json` for the full set.

### Search terms (quoting)

Each `queries` entry is placed **verbatim** after the `site:` filter, so you control exact-phrase vs. loose matching with quotes inside the JSON string:

| `config.json` value                  | Resulting query                              |
| ------------------------------------ | -------------------------------------------- |
| `"\"Registered Nurse in New York\""` | `site:{ats} "Registered Nurse in New York"`  |
| `"Registered Nurse in New York"`     | `site:{ats} Registered Nurse in New York`    |

`date_range` values map to Google's `qdr:` time filter:

| Value         | `tbs`     |
| ------------- | --------- |
| `anytime`     | _(none)_  |
| `past_hour`   | `qdr:h`   |
| `past_day`    | `qdr:d`   |
| `past_week`   | `qdr:w`   |
| `past_month`  | `qdr:m`   |
| `past_year`   | `qdr:y`   |

Editing `config.json` requires a redeploy (`npm run deploy`) — it is bundled into the worker.

## Output

The `WEBHOOK_OR_CSV` env variable decides where results go:

| `WEBHOOK_OR_CSV` | Behaviour                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `webhook` (default) | New jobs are POSTed to `WEBHOOK_URL` in batches of 100.                                     |
| `csv`            | `GET /run` returns the new jobs as a downloadable CSV file. **Recommended for local runs.**    |

CSV mode is delivered only over the HTTP `GET /run` endpoint (a worker cron has nowhere to write a file), so it's intended for local use:

```bash
curl "http://localhost:8787/run" -o jobs.csv   # or just open the URL in a browser
```

The CSV has a header row and one row per job: `title, url, snippet, date, query, ats, country`. New jobs are still de-duplicated against KV, so a second run only contains jobs not seen before.

## Webhook payload

```json
{
  "source": "directjobs-cron",
  "timestamp": "2026-06-28T00:00:00.000Z",
  "count": 1,
  "jobs": [
    {
      "title": "DevOps, AI and Automation Engineer (Contract)",
      "url": "https://tmhcc.wd108.myworkdayjobs.com/...",
      "snippet": "Engagement Type: Outside IR35 Contract...",
      "date": "5 days ago",
      "query": "Outside IR35",
      "ats": "Workday",
      "country": "gb"
    }
  ]
}
```

## How to get the alerts to your Telegram, Email, Slack?

You can use [Make](https://make.com) or [Zapier](https://zapier.com) to create automation, receiving the webhook, then send to whatever platform you like.

## Setup & deploy

```bash
# 1. Install deps
npm install

# 2. Log in to Cloudflare
npx wrangler login

# 3. Create the KV namespace and paste the printed id into wrangler.toml
npx wrangler kv namespace create SEEN_JOBS

# 4. Add your secrets
npx wrangler secret put SERPER_API_KEY
npx wrangler secret put WEBHOOK_URL   # destination for webhook mode (the default)

# 5. Deploy
npm run deploy
```

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in your key; set WEBHOOK_OR_CSV=csv for local runs
npm run dev                      # then hit http://localhost:8787/run
```

For local runs, set `WEBHOOK_OR_CSV=csv` in `.dev.vars` so a run downloads a CSV instead of needing a webhook:

```bash
curl "http://localhost:8787/run" -o jobs.csv
```

- `GET /run` triggers a search run manually. In webhook mode it returns a JSON summary; in CSV mode it returns the new jobs as a downloadable CSV file (run counts are in the `X-Run-Summary` response header), or `No new jobs found.` when there's nothing new.
- To test the cron path locally: `curl "http://localhost:8787/cdn-cgi/handler/scheduled"`. Note this returns `ok` and, in CSV mode, **does not** produce a file (a cron has nowhere to write one) — use `GET /run` to download a CSV.

## Changing the schedule

Edit the cron expression in `wrangler.toml` (`triggers.crons`) and redeploy.
`"0 0 * * *"` = daily at 00:00 UTC; 
`"0 * * * *"` = hourly.
