# Kadurdata

Israeli soccer data pipeline and schema exploration.

## Current Pieces

- React + TypeScript frontend: `src/`
- 365Scores ingestion spike: `scripts/ingest_365scores.py`
- Supabase/Postgres migration runner: `scripts/apply_migrations.py`
- Supabase loader: `scripts/load_365scores_to_supabase.py`
- Database schema and public API views: `db/migrations/`
- Scheduled GitHub Action: `.github/workflows/seed-supabase.yml`
- GitHub Pages deploy action: `.github/workflows/deploy-pages.yml`

## Supabase Setup

Create a Supabase project, then add this GitHub repository secret:

- `SUPABASE_DB_URL`
- `SUPABASE_ANON_KEY`

Use the Supabase Postgres connection string for `SUPABASE_DB_URL`. The seed GitHub Action uses it to:

1. apply migrations
2. fetch and flatten 365Scores data
3. load the processed rows into Supabase

Use the public Supabase anon key for `SUPABASE_ANON_KEY`. The GitHub Pages frontend uses it to query read-only public views:

- `public.api_overview`
- `public.api_players`
- `public.api_metrics`
- `public.api_player_leaderboard(season, metric)`
- `public.api_player_match_stats`
- `public.api_team_match_stats`

## Run Locally

```bash
python3 -m pip install -r requirements.txt
export SUPABASE_DB_URL="postgresql://..."
python3 scripts/apply_migrations.py
python3 scripts/ingest_365scores.py
python3 scripts/load_365scores_to_supabase.py
```

Generated data under `data/` is ignored by git.

## Frontend

```bash
npm install
cp .env.example .env
# add VITE_SUPABASE_ANON_KEY to .env for live Supabase data
npm run dev
```

Without `VITE_SUPABASE_ANON_KEY`, the local frontend renders a demo data state so the UI remains testable.
