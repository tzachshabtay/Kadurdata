#!/usr/bin/env python3
"""Read-only execution plans for a recent league match-stat query."""

import json
import os

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


if __name__ == "__main__":
    main()
