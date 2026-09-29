#!/usr/bin/env python3
"""Read-only execution plans for a recent league match-stat query."""

import json
import os
from pathlib import Path

import psycopg


def main():
    with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute("set local statement_timeout = '30s'")
            cur.execute("""
                select match_id from public.api_matches
                where competition_name = 'Israeli Premier League'
                  and season_name = '2026/2027'
                  and status in ('Ended', 'After ET', 'After Penalties')
                order by scheduled_at desc, match_id limit 35
            """)
            ids = [r[0] for r in cur.fetchall()]
            print(json.dumps({"matches": len(ids)}), flush=True)
            cur.execute("""
                select pg_get_viewdef('public.api_match_player_stats'::regclass, true)
            """)
            print(cur.fetchone()[0], flush=True)
            cur.execute("""
                explain (analyze, buffers, format json)
                select * from public.api_match_player_stats
                where match_id = any(%s::uuid[])
                order by match_id, metric_code limit 1000
            """, (ids,))
            print(json.dumps({"label": "current", "plan": cur.fetchone()[0]}), flush=True)
            migration = Path("db/migrations/042_push_match_filters_into_stat_values.sql").read_text()
            for view in ("api_match_player_stats", "api_match_team_stats"):
                proposed = migration.split(f"create or replace view public.{view} as\n", 1)[1].split(";", 1)[0]
                cur.execute(f"""
                    explain (analyze, buffers, format json)
                    select * from ({proposed}) proposed
                    where match_id = any(%s::uuid[])
                    order by match_id, metric_code limit 1000
                """, (ids,))
                print(json.dumps({"label": f"proposed-{view}", "plan": cur.fetchone()[0]}), flush=True)
                cur.execute(f"""
                    with current_rows as (
                      select * from public.{view} where match_id = any(%s::uuid[])
                    ), proposed_rows as (
                      select * from ({proposed}) proposed where match_id = any(%s::uuid[])
                    )
                    select count(*) from (
                      (select * from current_rows except all select * from proposed_rows)
                      union all
                      (select * from proposed_rows except all select * from current_rows)
                    ) difference
                """, (ids, ids))
                differences = cur.fetchone()[0]
                print(json.dumps({"view": view, "different_rows": differences}), flush=True)
                if differences:
                    raise RuntimeError(f"Proposed {view} changes data")


if __name__ == "__main__":
    main()
