#!/usr/bin/env python3
"""Print a read-only storage report for the configured Postgres database."""

from __future__ import annotations

import os

import psycopg


TRACKED_SCHEMAS = ("source", "core", "obs", "public")


def print_table(headers: tuple[str, ...], rows: list[tuple[object, ...]]) -> None:
    widths = [len(header) for header in headers]
    rendered = [["" if value is None else str(value) for value in row] for row in rows]
    for row in rendered:
        for index, value in enumerate(row):
            widths[index] = max(widths[index], len(value))

    print("  ".join(header.ljust(widths[index]) for index, header in enumerate(headers)))
    print("  ".join("-" * width for width in widths))
    for row in rendered:
        print("  ".join(value.ljust(widths[index]) for index, value in enumerate(row)))


def fetch_rows(cur: psycopg.Cursor, query: str) -> list[tuple[object, ...]]:
    cur.execute(query, (list(TRACKED_SCHEMAS),))
    return cur.fetchall()


def main() -> int:
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select pg_size_pretty(pg_database_size(current_database())), "
                "pg_database_size(current_database())"
            )
            database_size, database_bytes = cur.fetchone()
            print(f"Database size: {database_size} ({database_bytes} bytes)\n")

            relations = fetch_rows(
                cur,
                """
                select
                  namespace.nspname || '.' || relation.relname as relation,
                  greatest(relation.reltuples, 0)::bigint as estimated_rows,
                  pg_size_pretty(pg_relation_size(relation.oid)) as heap,
                  pg_size_pretty(pg_table_size(relation.oid) - pg_relation_size(relation.oid)) as toast_and_aux,
                  pg_size_pretty(pg_indexes_size(relation.oid)) as indexes,
                  pg_size_pretty(pg_total_relation_size(relation.oid)) as total,
                  pg_total_relation_size(relation.oid) as total_bytes
                from pg_class relation
                join pg_namespace namespace on namespace.oid = relation.relnamespace
                where relation.relkind in ('r', 'p')
                  and namespace.nspname = any(%s)
                order by total_bytes desc
                """,
            )
            print("Largest tables")
            print_table(
                ("relation", "est rows", "heap", "toast/aux", "indexes", "total", "bytes"),
                relations,
            )

            indexes = fetch_rows(
                cur,
                """
                select
                  table_namespace.nspname || '.' || table_relation.relname as relation,
                  index_relation.relname as index,
                  pg_size_pretty(pg_relation_size(index_relation.oid)) as size,
                  pg_relation_size(index_relation.oid) as bytes
                from pg_index index_definition
                join pg_class table_relation on table_relation.oid = index_definition.indrelid
                join pg_namespace table_namespace on table_namespace.oid = table_relation.relnamespace
                join pg_class index_relation on index_relation.oid = index_definition.indexrelid
                where table_namespace.nspname = any(%s)
                order by bytes desc
                limit 30
                """,
            )
            print("\nLargest indexes")
            print_table(("relation", "index", "size", "bytes"), indexes)

            table_stats = fetch_rows(
                cur,
                """
                select
                  schemaname || '.' || relname as relation,
                  n_live_tup,
                  n_dead_tup,
                  coalesce(last_autovacuum::text, 'never') as last_autovacuum,
                  coalesce(last_autoanalyze::text, 'never') as last_autoanalyze
                from pg_stat_user_tables
                where schemaname = any(%s)
                order by n_dead_tup desc, n_live_tup desc
                limit 30
                """,
            )
            print("\nLive and dead tuple estimates")
            print_table(
                ("relation", "live", "dead", "last autovacuum", "last autoanalyze"),
                table_stats,
            )

            cur.execute(
                """
                select
                  source.code,
                  observation.subject_type,
                  count(*) as observations,
                  count(distinct observation.match_id) as matches,
                  count(distinct observation.player_id) as players,
                  count(distinct observation.metric_id) as metrics
                from obs.stat_observations observation
                join source.sources source on source.id = observation.source_id
                group by source.code, observation.subject_type
                order by observations desc
                """
            )
            print("\nStat observations by source and subject")
            print_table(
                ("source", "subject", "observations", "matches", "players", "metrics"),
                cur.fetchall(),
            )

            cur.execute(
                """
                select
                  count(*) as observations,
                  round(avg(pg_column_size(observation)), 1) as average_row_bytes,
                  pg_size_pretty(sum(pg_column_size(observation))) as logical_row_size,
                  round(avg(length(observation.source_metric_name)), 1) as average_metric_name_chars,
                  round(avg(length(observation.raw_value)), 1) as average_raw_value_chars
                from obs.stat_observations observation
                """
            )
            print("\nStat observation row payload")
            print_table(
                ("observations", "avg row bytes", "logical rows", "avg metric chars", "avg raw chars"),
                cur.fetchall(),
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
