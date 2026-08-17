#!/usr/bin/env python3
"""Load processed FotMob history into the source-aware Supabase schema."""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from load_365scores_to_supabase import (
    execute_one,
    get_mapping,
    get_or_create_country,
    get_or_create_season,
    load_fixtures,
    load_player_rows,
    read_csv,
    upsert_mapping,
)


PROCESSED_DIR = Path("data/processed/fotmob")
SOURCE = {
    "code": "fotmob",
    "name": "FotMob",
    "kind": "unofficial_web_page_data",
    "base_url": "https://www.fotmob.com",
}
COMPETITION_SOURCE_ID = "127"
COMPETITION_NAME = "Israeli Premier League"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load historical FotMob rows into Supabase.")
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    return parser.parse_args()


def read_manifest(processed_dir: Path) -> dict[str, Any]:
    path = processed_dir / "fotmob_manifest.json"
    if not path.exists():
        raise SystemExit(f"missing required file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def get_source(cur: psycopg.Cursor, manifest: dict[str, Any]) -> str:
    source = SOURCE | (manifest.get("source") or {})
    row = execute_one(
        cur,
        """
        insert into source.sources (code, name, kind, base_url, priority)
        values (%s, %s, %s, %s, 20)
        on conflict (code) do update
          set name = excluded.name,
              kind = excluded.kind,
              base_url = excluded.base_url,
              updated_at = now()
        returning id
        """,
        (source["code"], source["name"], source["kind"], source["base_url"]),
    )
    assert row is not None
    return row["id"]


def get_competition(cur: psycopg.Cursor, source_id: str, country_id: str) -> str:
    mapped = get_mapping(cur, source_id, "competition", COMPETITION_SOURCE_ID)
    if mapped:
        return mapped
    row = execute_one(
        cur,
        "select id from core.competitions where country_id = %s and name = %s",
        (country_id, COMPETITION_NAME),
    )
    if not row:
        row = execute_one(
            cur,
            """
            insert into core.competitions (country_id, name, competition_type, gender)
            values (%s, %s, 'league', 'men')
            returning id
            """,
            (country_id, COMPETITION_NAME),
        )
    assert row is not None
    upsert_mapping(
        cur,
        source_id,
        "competition",
        COMPETITION_SOURCE_ID,
        "core.competitions",
        row["id"],
        "Ligat ha'Al",
        "ligat_haal",
        {"fotmob_league_id": 127},
    )
    return row["id"]


def normalized_name(value: str) -> str:
    value = value.lower().replace("petach", "petah").replace("reineh", "raina")
    value = re.sub(r"\b(?:fc|football club)\b", " ", value)
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def seed_entity_mappings(
    cur: psycopg.Cursor,
    source_id: str,
    entity_type: str,
    canonical_table: str,
    source_rows: dict[str, str],
    name_column: str,
) -> None:
    cur.execute(f"select id, {name_column} as name from {canonical_table}")
    canonical_by_name: dict[str, list[dict[str, Any]]] = {}
    for row in cur.fetchall():
        canonical_by_name.setdefault(normalized_name(row["name"]), []).append(row)
    for source_entity_id, source_name in source_rows.items():
        if get_mapping(cur, source_id, entity_type, source_entity_id):
            continue
        candidates = canonical_by_name.get(normalized_name(source_name), [])
        if len(candidates) != 1:
            continue
        upsert_mapping(
            cur,
            source_id,
            entity_type,
            source_entity_id,
            canonical_table,
            candidates[0]["id"],
            source_name,
        )


def manifest_season(manifest: dict[str, Any], season_num: str) -> dict[str, Any]:
    competitions = manifest.get("competitions") or []
    seasons = (competitions[0].get("seasons") or []) if competitions else []
    return next((season for season in seasons if str(season.get("num")) == season_num), {})


def main() -> int:
    args = parse_args()
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")
    fixtures = read_csv(args.processed_dir / "fotmob_fixtures.csv")
    players = read_csv(args.processed_dir / "fotmob_player_match_stats.csv")
    manifest = read_manifest(args.processed_dir)
    if not fixtures:
        raise SystemExit("processed FotMob fixture file contains no rows")

    fixture_groups: dict[str, list[dict[str, str]]] = {}
    match_seasons: dict[str, str] = {}
    for row in fixtures:
        season_num = row.get("season_num") or "unknown"
        fixture_groups.setdefault(season_num, []).append(row)
        match_seasons[row["game_id"]] = season_num
    player_groups: dict[str, list[dict[str, str]]] = {}
    for row in players:
        season_num = match_seasons.get(row.get("game_id") or "")
        if season_num:
            player_groups.setdefault(season_num, []).append(row)

    team_sources: dict[str, str] = {}
    for row in fixtures:
        for side in ("home", "away"):
            source_id = row.get(f"{side}_team_id")
            name = row.get(f"{side}_team")
            if source_id and name:
                team_sources[source_id] = name
    player_sources = {
        row["athlete_id"]: row["player_name"]
        for row in players
        if row.get("athlete_id") and row.get("player_name")
    }

    with psycopg.connect(database_url, row_factory=dict_row, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            source_id = get_source(cur, manifest)
            country_id = get_or_create_country(cur)
            competition_id = get_competition(cur, source_id, country_id)
            seed_entity_mappings(cur, source_id, "team", "core.teams", team_sources, "name")
            seed_entity_mappings(cur, source_id, "player", "core.players", player_sources, "display_name")
            conn.commit()

            for season_num, season_fixtures in sorted(fixture_groups.items()):
                season_id = get_or_create_season(
                    cur,
                    source_id,
                    competition_id,
                    COMPETITION_SOURCE_ID,
                    season_fixtures,
                    manifest_season(manifest, season_num),
                )
                indexes = load_fixtures(
                    cur,
                    source_id,
                    competition_id,
                    season_id,
                    season_fixtures,
                )
                conn.commit()
                season_players = player_groups.get(season_num, [])
                load_player_rows(
                    conn,
                    cur,
                    source_id,
                    country_id,
                    season_id,
                    season_players,
                    indexes,
                )
                conn.commit()
                print(
                    f"loaded FotMob {manifest_season(manifest, season_num).get('name', season_num)}: "
                    f"{len(indexes['matches'])} matches, {len(season_players)} player rows",
                    flush=True,
                )

    print(f"loaded {len(fixtures)} historical fixtures and {len(players)} player-match rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
