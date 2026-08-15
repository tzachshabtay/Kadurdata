#!/usr/bin/env python3
"""Apply SQL migrations to the configured Supabase/Postgres database."""

from __future__ import annotations

import os
import hashlib
from pathlib import Path

import psycopg


MIGRATIONS_DIR = Path("db/migrations")


def main() -> int:
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not migration_files:
        raise SystemExit(f"no migrations found in {MIGRATIONS_DIR}")

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                create table if not exists public.schema_migrations (
                  filename text primary key,
                  checksum text not null,
                  applied_at timestamptz not null default now()
                )
                """
            )
            for migration_file in migration_files:
                checksum = hashlib.sha256(migration_file.read_bytes()).hexdigest()
                cur.execute(
                    "select checksum from public.schema_migrations where filename = %s",
                    (migration_file.name,),
                )
                existing = cur.fetchone()
                if existing:
                    if existing[0] != checksum:
                        raise SystemExit(f"migration checksum changed after apply: {migration_file.name}")
                    print(f"skipping {migration_file}")
                    continue
                sql = migration_file.read_text(encoding="utf-8")
                print(f"applying {migration_file}")
                cur.execute(sql)
                cur.execute(
                    """
                    insert into public.schema_migrations (filename, checksum)
                    values (%s, %s)
                    """,
                    (migration_file.name, checksum),
                )
            cur.execute("notify pgrst, 'reload schema'")
        conn.commit()
        print("requested PostgREST schema cache reload")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
