# Canvas → Notion Sync

A single [Cloudflare Worker](https://developers.cloudflare.com/workers/) that
pulls your Canvas assignments (and optionally quizzes, grades, and
announcements) into a Notion database on a schedule you control from a settings
webpage. The webpage is protected by **Cloudflare Access**.

## How it works

- **One Worker** serves both the settings page and the sync logic.
- **Canvas** is read through its official REST API using a personal access
  token — reliable structured data, no HTML scraping.
- **Notion** items are upserted (matched on a hidden `Canvas ID` property), so
  re-syncing updates existing rows instead of creating duplicates.
- **Scheduling:** a cron fires every 15 minutes, but the Worker only actually
  syncs once your configured interval has elapsed — so changing the interval on
  the webpage takes effect without redeploying. There's also a **Sync now**
  button.
- **Settings + state** live in a Workers KV namespace. Tokens are masked when
  the page reads them back, and the settings API refuses to run at all until
  Cloudflare Access is configured.

```
Browser ──(Cloudflare Access)──▶ Worker ──▶ Canvas REST API
                                    │
                                    └──────▶ Notion API ──▶ your database
        cron (*/15) ────────────────▶ scheduled() ─▶ same sync
```

## Prerequisites

- A Cloudflare account (Workers + the free **Zero Trust / Access** plan).
- Node.js 18+ and `npx`.
- A Canvas account at your school.
- A Notion account.

## 1. Get a Canvas access token

In Canvas: **Account → Settings → Approved Integrations → New Access Token**.
Copy the token. Your **base URL** is what you log in at, e.g.
`https://yourschool.instructure.com`.

> If your school has disabled personal access tokens, this tool won't work
> as-is — that was a deliberate choice over fragile HTML scraping.

## 2. Create a Notion integration

1. Go to <https://www.notion.so/my-integrations> → **New integration**
   (internal). Copy the token (`secret_…` / `ntn_…`).
2. Open (or create) the Notion **page** you want the database to live under.
3. In that page: **⋯ menu → Connections → Connect to** your integration.
4. The page ID is the 32-character hex at the end of the page URL — or just
   paste the whole URL into the settings page, it'll extract the id.

The tool creates the database for you (with `Name`, `Course`, `Type`, `Due`,
`Points`, `Status`, `Grade`, `Canvas ID`, `Canvas Link` properties) when you
click **Create Notion database**.

## 3. Create the KV namespace

```bash
npm install
npx wrangler kv namespace create SETTINGS_KV
```

Copy the printed `id` into `wrangler.toml` under `[[kv_namespaces]]`.

## 4. Deploy the Worker

```bash
npx wrangler deploy
```

Note the deployed URL (e.g. `https://canvas-notion-sync.<subdomain>.workers.dev`).
Until Access is configured (next step) the page shows a setup notice and the API
refuses to expose anything.

## 5. Protect it

Pick **one** of the two options below. The Worker fails closed until one is set.

### Option A — Password (simplest, works on `*.workers.dev`)

Set a single Worker secret and you're done — no domain required:

```bash
npx wrangler secret put APP_PASSWORD   # type any password when prompted
```

The Worker then serves a login page and, on the correct password, sets a signed
12-hour session cookie. Good enough for a single user.

### Option B — Cloudflare Access (needs a custom domain)

If `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` are set they take precedence over the
password. In the **Cloudflare Zero Trust** dashboard:

1. **Access → Applications → Add an application → Self-hosted.**
2. Set the application domain to your Worker's hostname. (Access works on a
   custom domain / route; if you're on a `*.workers.dev` URL, add a
   [custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
   to the Worker and point the Access app at that.)
3. Add a policy — e.g. **Allow** where **Emails** is your email address.
4. Open the application's settings and copy its **Application Audience (AUD)
   tag**.
5. Your **team domain** is shown in **Settings → Custom Pages** /
   **Zero Trust overview**, e.g. `myteam.cloudflareaccess.com`.

Put both into `wrangler.toml` (or set them as secrets) and redeploy:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "myteam.cloudflareaccess.com"
ACCESS_AUD = "your-aud-tag"
```

```bash
npx wrangler deploy
```

The Worker verifies the Access JWT on every request as defense-in-depth, so
even a direct hit to the `workers.dev` URL is rejected without a valid Access
token.

## 6. Configure and sync

Open the Worker URL (you'll be prompted to log in via Access), then:

1. Fill in the Canvas base URL + token and the Notion token + parent page ID.
2. Click **Save settings**, then **Create Notion database**.
3. Pick what to sync (assignments, quizzes, announcements, only-items-worth-points,
   include grades) and the interval.
4. Click **Sync now** to test. After that the cron keeps it up to date.

## Configurable sync options

| Toggle | Effect |
| --- | --- |
| Assignments | Regular Canvas assignments |
| Quizzes | Assignments backed by a Canvas quiz |
| Announcements | Course announcements (as `Announcement` items) |
| Only items worth points | Skips anything with 0 / no points possible |
| Include my grade / score | Fetches your submission and writes your score |
| Auto-sync every | 15 min → 24 h |

`Status` is derived from your submission: `Not started`, `Submitted`, `Graded`,
or `Missing` (past due & unsubmitted).

## Notes & limits

- **Subrequests:** Cloudflare's free plan allows ~50 subrequests per invocation.
  Each course costs roughly one request per page of assignments, plus the Notion
  writes. With many courses you may hit the limit on the free plan — the Workers
  **paid** plan raises it to 1000. Pagination is capped defensively per course.
- **Token storage:** tokens are stored in KV (encrypted at rest by Cloudflare).
  Cloudflare Access is what keeps the settings page — and therefore the tokens —
  private. Don't use the "private URL only" approach.
- **Deletions:** items removed in Canvas are not deleted from Notion; existing
  rows are updated in place. Delete stale rows in Notion manually if you want.

## Local development

```bash
npm run dev        # wrangler dev
npm run typecheck  # tsc --noEmit
npm run tail       # stream live logs
```

In `wrangler dev` there's no Access layer; leave `ACCESS_*` empty to see the
setup page, or set them to test the verification path.
