# Kadurdata

Israeli soccer data pipeline and schema exploration.

## Current Pieces

- 365Scores ingestion spike: `scripts/ingest_365scores.py`
- Supabase/Postgres migration runner: `scripts/apply_migrations.py`
- Supabase loader: `scripts/load_365scores_to_supabase.py`
- Database schema: `db/migrations/001_initial_schema.sql`
- Scheduled GitHub Action: `.github/workflows/seed-supabase.yml`

## Supabase Setup

Create a Supabase project, then add this GitHub repository secret:

- `SUPABASE_DB_URL`

Use the Supabase Postgres connection string. The GitHub Action uses it to:

1. apply migrations
2. fetch and flatten 365Scores data
3. load the processed rows into Supabase

## Run Locally

```bash
python3 -m pip install -r requirements.txt
export SUPABASE_DB_URL="postgresql://..."
python3 scripts/apply_migrations.py
python3 scripts/ingest_365scores.py
python3 scripts/load_365scores_to_supabase.py
```

Generated data under `data/` is ignored by git.
