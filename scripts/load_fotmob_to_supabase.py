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
    competition_country_id,
    execute_one,
    get_mapping,
    get_or_create_competition,
    get_or_create_country,
    get_or_create_season,
    load_fixtures,
    load_player_rows,
    read_csv,
    to_float,
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
    parser.add_argument(
        "--existing-players-only",
        action="store_true",
        help="Ignore source players that are not already mapped to a canonical player.",
    )
    parser.add_argument(
        "--skip-existing-player-stats",
        action="store_true",
        help="Load a player appearance only when another source has not already supplied stats.",
    )
    parser.add_argument(
        "--prefer-source-appearance-minutes",
        action="store_true",
        help="Refresh canonical minutes from FotMob even when another source already supplied stats.",
    )
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


def manifest_competition(manifest: dict[str, Any]) -> dict[str, Any]:
    competitions = manifest.get("competitions") or []
    if not competitions:
        raise SystemExit("FotMob manifest contains no competition")
    return competitions[0]


def get_competition(
    cur: psycopg.Cursor,
    source_id: str,
    israel_country_id: str,
    competition: dict[str, Any],
) -> str:
    competition_source_id = str(competition.get("id") or COMPETITION_SOURCE_ID)
    competition_name = str(competition.get("name") or COMPETITION_NAME)
    country_id = competition_country_id(israel_country_id, competition)
    mapped = get_mapping(cur, source_id, "competition", competition_source_id)
    if mapped:
        return mapped
    row = execute_one(
        cur,
        """
        select id
        from core.competitions
        where lower(name) = lower(%s)
          and (country_id = %s or (country_id is null and %s::uuid is null))
        order by id
        limit 1
        """,
        (competition_name, country_id, country_id),
    )
    if not row:
        return get_or_create_competition(cur, source_id, country_id, competition)
    upsert_mapping(
        cur,
        source_id,
        "competition",
        competition_source_id,
        "core.competitions",
        row["id"],
        str(competition.get("source_name") or competition_name),
        metadata={"fotmob_league_id": competition.get("id")},
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


def seed_match_mappings(
    cur: psycopg.Cursor,
    source_id: str,
    season_id: str,
    rows: list[dict[str, str]],
) -> int:
    mapped_count = 0
    for row in rows:
        source_match_id = row.get("game_id") or ""
        if not source_match_id or get_mapping(cur, source_id, "match", source_match_id):
            continue
        home_team_id = get_mapping(cur, source_id, "team", row.get("home_team_id") or "")
        away_team_id = get_mapping(cur, source_id, "team", row.get("away_team_id") or "")
        scheduled_at = row.get("start_time")
        if not home_team_id or not away_team_id or not scheduled_at:
            continue
        cur.execute(
            """
            select id
            from core.matches
            where season_id = %s
              and home_team_id = %s
              and away_team_id = %s
              and abs(extract(epoch from (scheduled_at - %s::timestamptz))) <= 21600
            order by abs(extract(epoch from (scheduled_at - %s::timestamptz))), id
            limit 2
            """,
            (season_id, home_team_id, away_team_id, scheduled_at, scheduled_at),
        )
        candidates = cur.fetchall()
        if len(candidates) != 1:
            continue
        upsert_mapping(
            cur,
            source_id,
            "match",
            source_match_id,
            "core.matches",
            candidates[0]["id"],
        )
        mapped_count += 1
    return mapped_count


def filter_player_rows(
    cur: psycopg.Cursor,
    source_id: str,
    rows: list[dict[str, str]],
    indexes: dict[str, Any],
    existing_players_only: bool,
    skip_existing_player_stats: bool,
    prefer_source_appearance_minutes: bool,
) -> tuple[list[dict[str, str]], int, int, int]:
    candidates: list[tuple[dict[str, str], str, str, str]] = []
    missing_players = 0
    for row in rows:
        player_id = get_mapping(cur, source_id, "player", row.get("athlete_id") or "")
        if not player_id:
            if existing_players_only:
                missing_players += 1
                continue
            return rows, 0, 0, 0
        match_id = indexes["matches"].get(row.get("game_id") or "")
        team_id = indexes["teams"].get(row.get("team_id") or "")
        if match_id and team_id:
            candidates.append((row, str(match_id), str(player_id), str(team_id)))

    if not skip_existing_player_stats or not candidates:
        return [item[0] for item in candidates], missing_players, 0, 0

    match_ids = sorted({item[1] for item in candidates})
    player_ids = sorted({item[2] for item in candidates})
    cur.execute(
        """
        select distinct appearance.match_id, appearance.player_id, appearance.team_id
        from core.player_match_appearances appearance
        join obs.player_match_stats stats on stats.appearance_id = appearance.id
        where appearance.match_id = any(%s::uuid[])
          and appearance.player_id = any(%s::uuid[])
          and stats.source_id <> %s
        """,
        (match_ids, player_ids, source_id),
    )
    existing = {
        (str(row["match_id"]), str(row["player_id"]), str(row["team_id"]))
        for row in cur.fetchall()
    }
    updated_minutes = 0
    if prefer_source_appearance_minutes:
        minute_updates = [
            (to_float(row.get("stat_minutes_value")), match_id, player_id, team_id)
            for row, match_id, player_id, team_id in candidates
            if (match_id, player_id, team_id) in existing
            and to_float(row.get("stat_minutes_value")) is not None
        ]
        if minute_updates:
            cur.executemany(
                """
                update core.player_match_appearances
                set minutes_played = %s
                where match_id = %s
                  and player_id = %s
                  and team_id = %s
                """,
                minute_updates,
            )
            updated_minutes = len(minute_updates)
    filtered = [
        row
        for row, match_id, player_id, team_id in candidates
        if (match_id, player_id, team_id) not in existing
    ]
    return filtered, missing_players, len(candidates) - len(filtered), updated_minutes


def main() -> int:
    args = parse_args()
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")
    fixtures = read_csv(args.processed_dir / "fotmob_fixtures.csv")
    players = read_csv(args.processed_dir / "fotmob_player_match_stats.csv")
    manifest = read_manifest(args.processed_dir)
    competition = manifest_competition(manifest)
    competition_source_id = str(competition.get("id") or COMPETITION_SOURCE_ID)
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
            competition_id = get_competition(cur, source_id, country_id, competition)
            seed_entity_mappings(cur, source_id, "team", "core.teams", team_sources, "name")
            seed_entity_mappings(cur, source_id, "player", "core.players", player_sources, "display_name")
            conn.commit()

            for season_num, season_fixtures in sorted(fixture_groups.items()):
                season_id = get_or_create_season(
                    cur,
                    source_id,
                    competition_id,
                    competition_source_id,
                    season_fixtures,
                    manifest_season(manifest, season_num),
                )
                mapped_matches = seed_match_mappings(
                    cur,
                    source_id,
                    season_id,
                    season_fixtures,
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
                season_players, missing_players, skipped_existing, updated_minutes = filter_player_rows(
                    cur,
                    source_id,
                    season_players,
                    indexes,
                    args.existing_players_only,
                    args.skip_existing_player_stats,
                    args.prefer_source_appearance_minutes,
                )
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
                    f"{len(indexes['matches'])} matches ({mapped_matches} matched across sources), "
                    f"{len(season_players)} player rows "
                    f"({skipped_existing} existing rows skipped, {updated_minutes} minute totals refreshed, "
                    f"{missing_players} unmapped players skipped)",
                    flush=True,
                )

    print(f"loaded {len(fixtures)} historical fixtures and {len(players)} player-match rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
