# Kadurdata

Israeli soccer data pipeline and schema exploration.

## Current Pieces

- React + TypeScript frontend: `src/`
- 365Scores domestic, UEFA club, and Israel national-team ingestion: `scripts/ingest_365scores.py`
- FotMob historical Ligat Ha'Al ingestion: `scripts/ingest_fotmob.py`
- FotMob/SciSports player valuation ingestion: `scripts/ingest_fotmob_valuations.py`
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
2. discover domestic competitions plus Israel-related UEFA and national-team competitions
3. keep UEFA/international fixtures involving an Israeli club or Israel national side
4. fetch every match-bearing source season and load match, team, and player stats

Scheduled match refreshes run every two hours with a recent rolling window
across every competition. Legionnaire census discovery, rosters, loans, and
Hebrew-name maintenance run daily. Manual runs use 2010/11 as the lower bound
and load every result page and current fixture season still exposed by
365Scores. Older winner/standings-only history is not loaded from 365Scores
because it has no match payloads. The separate
`Seed FotMob History` workflow fills Ligat Ha'Al seasons from 2010/11 through
2024/25 with fixtures and results, plus player-match stats wherever FotMob's
historical match pages expose them.

Use the public Supabase anon key for `SUPABASE_ANON_KEY`. The GitHub Pages frontend uses it to query read-only public views:

- `public.api_overview`
- `public.api_players`
- `public.api_metrics`
- `public.api_season_players_for_season(season)`
- `public.api_player_leaderboard(season, metric)`
- `public.api_player_match_stats`
- `public.api_team_match_stats`
- `public.api_player_valuations`

## Run Locally

```bash
python3 -m pip install -r requirements.txt
export SUPABASE_DB_URL="postgresql://..."
python3 scripts/apply_migrations.py
python3 scripts/ingest_365scores.py --all-israeli-competitions --israel-related-competitions --start-date 2010-07-01
python3 scripts/load_365scores_to_supabase.py
```

For historical Ligat Ha'Al seasons:

```bash
python3 scripts/ingest_fotmob.py --fixtures-only
python3 scripts/load_fotmob_to_supabase.py

# Refresh recent players' SciSports ETV history exposed through FotMob.
python3 scripts/ingest_fotmob_valuations.py --lookback-years 3 --allow-fetch-failures
python3 scripts/load_fotmob_valuations_to_supabase.py
```

Omit `--fixtures-only` to also request historical match pages and import the
player metrics available for those matches. The FotMob loader uses a separate
source identity and maps rows into the same canonical competition and seasons.

For a quick catalog refresh without player and team payloads:

```bash
python3 scripts/ingest_365scores.py --all-israeli-competitions --israel-related-competitions --fixtures-only
python3 scripts/load_365scores_to_supabase.py
```

Generated data under `data/` is ignored by git.

External competitions are discovered through a curated set of UEFA/FIFA
competition IDs and Israeli participant IDs. Only matches containing an Israeli
club or Israel national side are retained, which keeps the database small while
preserving player and team detail for every relevant match the source exposes.

## Frontend

```bash
npm install
cp .env.example .env
# add VITE_SUPABASE_ANON_KEY to .env for live Supabase data
npm run dev
```

Without `VITE_SUPABASE_ANON_KEY`, the local frontend renders a demo data state so the UI remains testable.

## Hebrew Content Pipeline

The Hebrew-only `בלוג` tab reads fact-checked article packages from
`src/content/generated/`. Each match review is built in five stages:

1. Select a completed Ligat Ha'Al match with team, player, shot, event-timeline, and heatmap data.
2. Compare both teams with up to five preceding matches, and detect player changes only in high-volume metrics with at least three comparable appearances.
3. Derive time-window flow and spatial-team profiles, then convert current and historical data into a grounded evidence bundle.
4. Ask the OpenAI Responses API for one cohesive Hebrew narrative whose claims cite evidence IDs.
5. Run a separate senior-editor pass for idiomatic Hebrew, numerical clarity, narrative flow, and misuse of small samples.
6. Reject the draft if the editorial review, score, event total, xG cross-check, historical date, evidence link, tag set, or numeric claim fails.
7. Publish the JSON package with Hebrew team, player, and `סיכום משחק` tags; Vite discovers it automatically and adds it to the filterable blog archive.

Generate the latest eligible match with AI:

```bash
npm run content:generate:latest
npm run content:validate
npm run build
```

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` and `OPENAI_EDITOR_MODEL` in `.env`. The checked-in sample
can be rebuilt without an API request with `npm run content:generate:sample`.

`.github/workflows/generate-content.yml` runs on Monday and Thursday, skips a match
that is already published, validates the evidence package, builds the site, and only
commits the generated article after every gate passes. A match UUID can also be
supplied in a manual workflow run for a specific review.
