# Kadurdata

Israeli soccer data pipeline and schema exploration.

## Current Pieces

- React + TypeScript frontend: `src/`
- 365Scores Israeli competition ingestion: `scripts/ingest_365scores.py`
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
2. discover Israeli competitions and fetch every match-bearing source season
3. load the processed rows into Supabase

Scheduled runs use a recent rolling window across every competition. Manual
runs default to a full backfill of every result season and current fixture
season still exposed by 365Scores. Older winner/standings-only history is not
loaded as an empty season because it has no match or player-stat payloads.

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
python3 scripts/ingest_365scores.py --all-israeli-competitions
python3 scripts/load_365scores_to_supabase.py
```

For a quick catalog refresh without player and team payloads:

```bash
python3 scripts/ingest_365scores.py --all-israeli-competitions --fixtures-only
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
