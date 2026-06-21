# Free Hosting And Database Options

Research date: 2026-06-20

Goal: host a mostly-static Israeli soccer stats site cheaply, ideally with GitHub Pages, while still supporting a repeatedly seeded database.

## Short Answer

Yes, a GitHub Pages frontend is possible.

The cleanest free setup is:

1. **Frontend:** GitHub Pages
2. **Database:** Supabase Free
3. **Seeder:** GitHub Actions scheduled workflow
4. **Frontend data access:** Supabase browser client, read-only public views with Row Level Security

This keeps the website simple and static while the data lives in Postgres.

## Recommended Architecture

```mermaid
flowchart LR
  actions["GitHub Actions Seeder"] --> supabase["Supabase Postgres"]
  pages["GitHub Pages Static App"] --> supabase_api["Supabase REST/JS API"]
  supabase_api --> supabase
  supabase --> views["analytics.* read-only views"]
```

### Why This Is The Best Fit

- Our proposed schema is PostgreSQL-native.
- Supabase gives us hosted Postgres plus an auto-generated API.
- A GitHub Pages app can call Supabase directly from browser JavaScript.
- Supabase's publishable/anon key is allowed in browser code as long as Row Level Security is enabled and policies are read-only.
- GitHub Actions can run the 365Scores ingestion on a schedule and write to Supabase using a secret service-role key.

## Option 1: GitHub Pages + Supabase

Status: recommended first choice.

Current free-tier details from official pricing:

- 500 MB database
- unlimited API requests
- 50,000 monthly active users
- 5 GB egress
- 1 GB file storage

Pros:

- Real Postgres, matching our schema design.
- Browser-friendly API.
- Built-in auth and Row Level Security if needed later.
- Good developer experience.
- Easy upgrade path.

Cons:

- 500 MB database limit means we should not store raw provider payloads in Postgres.
- Free projects can have limitations that are annoying for production.
- Requires careful RLS policies so public users can only read safe views.

Recommended data policy on free tier:

- Store canonical/resolved/queryable data in Postgres.
- Store source IDs and scalar `raw_value` strings only where they help debugging metric parsing.
- Do not expose `source.*` and `obs.*` tables directly to the public frontend.
- Expose only `analytics.*` views through read-only policies.

## Option 2: GitHub Pages + Neon

Status: good database, less ideal for a static-only app.

Current free-tier details from official pricing:

- 0.5 GB storage per project
- 100 CU-hours monthly per project
- no credit card required
- Postgres

Pros:

- Real Postgres.
- Strong branching/development workflow.
- Good fit for server-side apps.

Cons:

- A browser app should not connect directly to Postgres.
- We would need an API layer, for example Cloudflare Workers, Vercel, Netlify Functions, or a small server.
- Same storage issue as Supabase: 0.5 GB is tight if we keep payload history.

Use Neon if:

- We decide to build an API backend instead of a fully static frontend.
- We want Postgres branching more than browser-direct simplicity.

## Option 3: Cloudflare Pages + Cloudflare Workers + D1

Status: best all-free Cloudflare stack, but it changes the database design from Postgres to SQLite.

Current free-tier details from official pages:

- Cloudflare Pages: unlimited static requests/bandwidth on Free, 500 builds/month.
- Workers Free: 100,000 requests/day.
- D1 Free: 5 GB total storage, 5 million rows read/day, 100,000 rows written/day.

Pros:

- Very generous free storage for this project.
- Static frontend plus serverless API in one platform.
- D1 is simple and cheap.

Cons:

- D1 is SQLite, not Postgres.
- Some parts of the proposed schema/migrations would need adjustment.
- Frontend should call a Worker API, not D1 directly.

Use Cloudflare if:

- We are okay moving from Postgres to SQLite.
- We want more free storage and an integrated serverless API.
- We do not need complex Postgres features.

## Option 4: GitHub Pages + Turso

Status: good SQLite option, but likely needs an API layer.

Current free-tier details from official pricing/blog:

- Free plan
- 100 databases
- 5 GB storage
- 500 million rows read/month
- 10 million rows written/month

Pros:

- Generous free limits.
- SQLite is lightweight and easy to reason about.
- Good fit for read-heavy analytics.

Cons:

- Our current schema is designed for Postgres.
- Browser-to-database credentials are risky for writes or private data.
- Better with a small API layer.

Use Turso if:

- We prefer SQLite and edge-style reads.
- We are willing to add a backend/API layer.

## Option 5: Fully Static Data Files

Status: simplest possible deployment, not a real database.

Architecture:

- GitHub Actions runs the seeder.
- Seeder writes compressed JSON/Parquet/CSV summaries into the repo or release artifacts.
- GitHub Pages serves the app and static data files.

Pros:

- Truly free.
- No database account.
- Extremely reliable for read-only public stats.
- Great for precomputed charts and leaderboards.

Cons:

- No dynamic database queries.
- Larger data files can make the app slow.
- Rebuilding data requires committing generated files or publishing assets.
- Harder to build flexible filters across many seasons and players.

Use this if:

- The first version is mostly precomputed dashboards.
- We want absolute simplicity before introducing a hosted database.

## Recommendation

Start with **GitHub Pages + Supabase Free + GitHub Actions**.

This is the best match for the current direction because:

- The schema we designed is Postgres.
- The frontend can stay static.
- Supabase provides a browser-safe API when RLS is configured correctly.
- The seeder can run separately in GitHub Actions with secret credentials.

## Proposed Deployment Flow

1. Create Supabase project.
2. Run `db/migrations/001_initial_schema.sql`.
3. Add seed script that writes to Supabase Postgres.
4. Store Supabase service-role key only in GitHub Actions secrets.
5. Create read-only `analytics` views for website queries.
6. Enable Row Level Security on exposed tables/views.
7. Add read-only public policies only for safe `analytics` views.
8. Deploy static frontend to GitHub Pages.
9. GitHub Actions runs ingestion daily or weekly.

## Data Size Strategy

Supabase Free gives 500 MB. Our generated local `data/` folder is already tens of MB because the spike cached provider payloads locally.

Recommended:

- Keep provider payloads out of the free database.
- Insert only canonical tables, mappings, appearance rows, metric observations, and analytics views.
- Keep enough source IDs to re-fetch data if needed.
- Use local payload caches only while developing/debugging the seeder.

## Security Model

Public frontend:

- Uses Supabase publishable/anon key.
- Can read only `analytics.*` views.
- Cannot insert/update/delete.
- Cannot read source mapping or observation tables directly.

Seeder:

- Runs in GitHub Actions.
- Uses Supabase service-role key from GitHub Secrets.
- Can insert/update all ingestion tables.
- Never ships service-role key to the browser.

## Decision Matrix

| Option | Frontend | Database | Backend/API Needed | Free Fit | Schema Fit | Recommendation |
|---|---|---|---:|---:|---:|---|
| GitHub Pages + Supabase | GitHub Pages | Postgres | No | Good | Excellent | Best first choice |
| GitHub Pages + Neon | GitHub Pages | Postgres | Yes | Good | Excellent | Good if we add API |
| Cloudflare Pages + D1 | Cloudflare Pages | SQLite | Yes, Workers | Excellent | Medium | Best all-Cloudflare option |
| GitHub Pages + Turso | GitHub Pages | SQLite/libSQL | Usually yes | Excellent | Medium | Good SQLite option |
| GitHub Pages + static files | GitHub Pages | None | No | Excellent | Low | Good MVP fallback |

## Sources

- GitHub Pages docs: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- GitHub Actions docs: https://docs.github.com/actions
- Supabase pricing: https://supabase.com/pricing
- Supabase Row Level Security docs: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase API keys docs: https://supabase.com/docs/guides/getting-started/api-keys
- Neon pricing: https://neon.com/pricing
- Cloudflare Pages: https://pages.cloudflare.com/
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Turso pricing: https://turso.tech/pricing
