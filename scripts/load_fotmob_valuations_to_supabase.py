#!/usr/bin/env python3
"""Load processed FotMob/SciSports player valuation history into Supabase."""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
from typing import Any, Optional

import psycopg
from psycopg.rows import dict_row


PROCESSED_DIR = Path("data/processed/fotmob-valuations")
FOTMOB_SOURCE = {
    "code": "fotmob",
    "name": "FotMob",
    "kind": "unofficial_web_page_data",
    "base_url": "https://www.fotmob.com",
    "priority": 20,
}
VALUATION_SOURCE = {
    "code": "scisports_etv_fotmob",
    "name": "SciSports ETV via FotMob",
    "kind": "derived_market_valuation",
    "base_url": "https://www.fotmob.com",
    "priority": 50,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load FotMob/SciSports valuations into Supabase.")
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    return parser.parse_args()


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise SystemExit(f"missing required file: {path}")
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def get_source(cur: psycopg.Cursor, source: dict[str, Any]) -> str:
    row = cur.execute(
        """
        insert into source.sources (code, name, kind, base_url, priority)
        values (%s, %s, %s, %s, %s)
        on conflict (code) do update
          set name = excluded.name,
              kind = excluded.kind,
              base_url = excluded.base_url,
              priority = excluded.priority,
              updated_at = now()
        returning id
        """,
        (
            source["code"],
            source["name"],
            source["kind"],
            source["base_url"],
            source["priority"],
        ),
    ).fetchone()
    assert row is not None
    return str(row["id"])


def integer_or_none(value: Optional[str]) -> Optional[int]:
    if value is None or value.strip() == "":
        return None
    return int(value)


def upsert_fotmob_mapping(
    cur: psycopg.Cursor,
    fotmob_source_id: str,
    row: dict[str, str],
) -> None:
    existing = cur.execute(
        """
        select canonical_id
        from source.source_entity_ids
        where source_id = %s
          and entity_type = 'player'
          and source_entity_id = %s
        """,
        (fotmob_source_id, row["source_player_id"]),
    ).fetchone()
    if existing and existing["canonical_id"] and str(existing["canonical_id"]) != row["canonical_player_id"]:
        raise RuntimeError(
            f"FotMob player {row['source_player_id']} is already mapped to {existing['canonical_id']}"
        )
    cur.execute(
        """
        insert into source.source_entity_ids as mapping (
          source_id,
          entity_type,
          source_entity_id,
          canonical_table,
          canonical_id,
          source_name,
          confidence,
          mapping_status
        )
        values (%s, 'player', %s, 'core.players', %s, %s, 1, 'auto')
        on conflict (source_id, entity_type, source_entity_id) do update
          set canonical_table = excluded.canonical_table,
              canonical_id = coalesce(mapping.canonical_id, excluded.canonical_id),
              source_name = excluded.source_name,
              last_seen_at = now()
        """,
        (
            fotmob_source_id,
            row["source_player_id"],
            row["canonical_player_id"],
            row["player_name"],
        ),
    )


def main() -> int:
    args = parse_args()
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    rows = read_csv(args.processed_dir / "player_valuations.csv")
    manifest_path = args.processed_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    if not rows:
        raise SystemExit("processed valuation file contains no rows")

    with psycopg.connect(database_url, row_factory=dict_row, prepare_threshold=None) as connection:
        with connection.cursor() as cur:
            fotmob_source_id = get_source(cur, FOTMOB_SOURCE)
            valuation_source_id = get_source(cur, VALUATION_SOURCE | (manifest.get("source") or {}))

            player_rows: dict[str, dict[str, str]] = {}
            for row in rows:
                player_rows[row["source_player_id"]] = row
            for row in player_rows.values():
                upsert_fotmob_mapping(cur, fotmob_source_id, row)

            cur.executemany(
                """
                insert into obs.player_valuations (
                  source_id,
                  player_id,
                  source_player_id,
                  valuation_date,
                  value_amount,
                  currency,
                  lower_bound,
                  upper_bound,
                  provider,
                  source_team_id,
                  source_team_name,
                  source_url,
                  observed_at
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                on conflict (source_id, source_player_id, valuation_date) do update
                  set player_id = excluded.player_id,
                      value_amount = excluded.value_amount,
                      currency = excluded.currency,
                      lower_bound = excluded.lower_bound,
                      upper_bound = excluded.upper_bound,
                      provider = excluded.provider,
                      source_team_id = excluded.source_team_id,
                      source_team_name = excluded.source_team_name,
                      source_url = excluded.source_url,
                      observed_at = now()
                """,
                [
                    (
                        valuation_source_id,
                        row["canonical_player_id"],
                        row["source_player_id"],
                        row["valuation_date"],
                        int(row["value_amount"]),
                        row["currency"],
                        integer_or_none(row.get("lower_bound")),
                        integer_or_none(row.get("upper_bound")),
                        row.get("provider") or "scisports",
                        row.get("source_team_id") or None,
                        row.get("source_team_name") or None,
                        row.get("source_url") or None,
                    )
                    for row in rows
                ],
            )
        connection.commit()

    print(f"loaded {len(rows)} valuations for {len(player_rows)} players")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
