#!/usr/bin/env python3
"""Load processed 365Scores CSVs into the source-aware Postgres schema."""

from __future__ import annotations

import csv
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


PROCESSED_DIR = Path("data/processed")
SOURCE_CODE = "365scores"
SOURCE_NAME = "365Scores"
SOURCE_KIND = "unofficial_web_api"
SOURCE_BASE_URL = "https://webws.365scores.com"
COUNTRY_ISRAEL = {"name": "Israel", "iso2": "IL", "iso3": "ISR"}
COMPETITION_SOURCE_ID = "42"
COMPETITION_NAME = "Israeli Premier League"


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise SystemExit(f"missing required file: {path}")
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def empty_to_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def to_int(value: Any) -> Optional[int]:
    text = empty_to_none(value)
    if text is None:
        return None
    return int(float(text))


def to_float(value: Any) -> Optional[float]:
    text = empty_to_none(value)
    if text is None:
        return None
    return float(text)


def season_name(rows: Iterable[dict[str, str]]) -> str:
    years = sorted({(row.get("start_time") or "")[:4] for row in rows if row.get("start_time")})
    if len(years) >= 2:
        return f"{years[0]}/{years[-1][-2:]}"
    if years:
        return years[0]
    return "unknown"


def normalize_stage_name(stage_num: Optional[int]) -> str:
    if stage_num == 1:
        return "Regular Season"
    if stage_num == 2:
        return "Playoffs"
    return f"Stage {stage_num}" if stage_num is not None else "Unknown Stage"


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_")


def metric_from_stat_column(column: str) -> Optional[str]:
    if not column.startswith("stat_"):
        return None
    for suffix in ("_raw", "_value", "_attempted", "_percentage"):
        if column.endswith(suffix):
            return column[len("stat_") : -len(suffix)]
    return None


def attempted_metric_code(base_code: str) -> str:
    replacements = (
        ("_completed", "_attempted"),
        ("_won", "_attempted"),
        ("_saved", "_faced"),
    )
    for old, new in replacements:
        if base_code.endswith(old):
            return f"{base_code[: -len(old)]}{new}"
    if base_code == "successful_dribbles":
        return "dribbles_attempted"
    return f"{base_code}_attempted"


def percentage_metric_code(base_code: str) -> str:
    special_cases = {
        "passes_completed": "pass_completion_pct",
        "long_passes_completed": "long_pass_completion_pct",
        "crosses_completed": "cross_completion_pct",
        "successful_dribbles": "dribble_success_pct",
        "tackles_won": "tackle_success_pct",
        "aerial_duels_won": "aerial_duel_win_pct",
        "ground_duels_won": "ground_duel_win_pct",
    }
    return special_cases.get(base_code, f"{base_code}_pct")


def metric_name(code: str) -> str:
    return code.replace("_", " ").title()


def execute_one(cur: psycopg.Cursor, sql: str, params: tuple[Any, ...]) -> Optional[dict[str, Any]]:
    cur.execute(sql, params)
    return cur.fetchone()


def get_source(cur: psycopg.Cursor) -> str:
    row = execute_one(
        cur,
        """
        insert into source.sources (code, name, kind, base_url, priority)
        values (%s, %s, %s, %s, 10)
        on conflict (code) do update
          set name = excluded.name,
              kind = excluded.kind,
              base_url = excluded.base_url,
              updated_at = now()
        returning id
        """,
        (SOURCE_CODE, SOURCE_NAME, SOURCE_KIND, SOURCE_BASE_URL),
    )
    assert row is not None
    return row["id"]


def get_or_create_country(cur: psycopg.Cursor) -> str:
    row = execute_one(cur, "select id from core.countries where iso2 = %s", (COUNTRY_ISRAEL["iso2"],))
    if row:
        return row["id"]
    row = execute_one(
        cur,
        "insert into core.countries (name, iso2, iso3) values (%s, %s, %s) returning id",
        (COUNTRY_ISRAEL["name"], COUNTRY_ISRAEL["iso2"], COUNTRY_ISRAEL["iso3"]),
    )
    assert row is not None
    return row["id"]


def get_mapping(
    cur: psycopg.Cursor,
    source_id: str,
    entity_type: str,
    source_entity_id: str,
) -> Optional[str]:
    row = execute_one(
        cur,
        """
        select canonical_id
        from source.source_entity_ids
        where source_id = %s and entity_type = %s and source_entity_id = %s
        """,
        (source_id, entity_type, source_entity_id),
    )
    return row["canonical_id"] if row else None


def upsert_mapping(
    cur: psycopg.Cursor,
    source_id: str,
    entity_type: str,
    source_entity_id: str,
    canonical_table: str,
    canonical_id: str,
    source_name: Optional[str] = None,
    source_slug: Optional[str] = None,
) -> None:
    cur.execute(
        """
        insert into source.source_entity_ids (
          source_id, entity_type, source_entity_id, canonical_table, canonical_id,
          source_name, source_slug, last_seen_at
        )
        values (%s, %s, %s, %s, %s, %s, %s, now())
        on conflict (source_id, entity_type, source_entity_id) do update
          set canonical_table = excluded.canonical_table,
              canonical_id = excluded.canonical_id,
              source_name = coalesce(excluded.source_name, source.source_entity_ids.source_name),
              source_slug = coalesce(excluded.source_slug, source.source_entity_ids.source_slug),
              last_seen_at = now()
        """,
        (source_id, entity_type, source_entity_id, canonical_table, canonical_id, source_name, source_slug),
    )


def get_or_create_competition(cur: psycopg.Cursor, source_id: str, country_id: str) -> str:
    mapped = get_mapping(cur, source_id, "competition", COMPETITION_SOURCE_ID)
    if mapped:
        return mapped
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
    competition_id = row["id"]
    upsert_mapping(
        cur,
        source_id,
        "competition",
        COMPETITION_SOURCE_ID,
        "core.competitions",
        competition_id,
        COMPETITION_NAME,
        "premier-league",
    )
    return competition_id


def get_or_create_season(cur: psycopg.Cursor, source_id: str, competition_id: str, rows: list[dict[str, str]]) -> str:
    season_num = rows[0].get("season_num") or "unknown"
    source_entity_id = f"{COMPETITION_SOURCE_ID}:{season_num}"
    mapped = get_mapping(cur, source_id, "season", source_entity_id)
    if mapped:
        return mapped

    name = season_name(rows)
    start_date = min((row.get("start_time") or "")[:10] for row in rows if row.get("start_time"))
    end_date = max((row.get("start_time") or "")[:10] for row in rows if row.get("start_time"))
    row = execute_one(
        cur,
        """
        insert into core.seasons (competition_id, name, start_date, end_date)
        values (%s, %s, %s, %s)
        on conflict (competition_id, name) do update
          set start_date = least(core.seasons.start_date, excluded.start_date),
              end_date = greatest(core.seasons.end_date, excluded.end_date)
        returning id
        """,
        (competition_id, name, start_date, end_date),
    )
    assert row is not None
    season_id = row["id"]
    upsert_mapping(cur, source_id, "season", source_entity_id, "core.seasons", season_id, name)
    return season_id


def get_or_create_stage(cur: psycopg.Cursor, season_id: str, stage_num: Optional[int]) -> str:
    row = execute_one(
        cur,
        """
        insert into core.season_stages (season_id, name, stage_type, stage_number)
        values (%s, %s, %s, %s)
        on conflict (season_id, stage_number) do update
          set name = excluded.name,
              stage_type = excluded.stage_type
        returning id
        """,
        (
            season_id,
            normalize_stage_name(stage_num),
            "regular" if stage_num == 1 else "playoff" if stage_num == 2 else None,
            stage_num,
        ),
    )
    assert row is not None
    return row["id"]


def get_or_create_round(cur: psycopg.Cursor, stage_id: str, round_num: Optional[int], round_name: Optional[str]) -> Optional[str]:
    if round_num is None:
        return None
    row = execute_one(
        cur,
        """
        insert into core.rounds (stage_id, round_number, name)
        values (%s, %s, %s)
        on conflict (stage_id, round_number) do update
          set name = coalesce(excluded.name, core.rounds.name)
        returning id
        """,
        (stage_id, round_num, round_name),
    )
    assert row is not None
    return row["id"]


def get_or_create_team(cur: psycopg.Cursor, source_id: str, source_team_id: str, name: str) -> str:
    mapped = get_mapping(cur, source_id, "team", source_team_id)
    if mapped:
        cur.execute("update core.teams set name = %s where id = %s", (name, mapped))
        return mapped
    row = execute_one(cur, "insert into core.teams (name) values (%s) returning id", (name,))
    assert row is not None
    team_id = row["id"]
    upsert_mapping(cur, source_id, "team", source_team_id, "core.teams", team_id, name, slugify(name))
    return team_id


def get_or_create_player(
    cur: psycopg.Cursor,
    source_id: str,
    source_player_id: str,
    name: str,
    country_id: Optional[int],
    position_name: Optional[str],
) -> str:
    mapped = get_mapping(cur, source_id, "player", source_player_id)
    if mapped:
        cur.execute(
            """
            update core.players
            set display_name = %s,
                primary_position = coalesce(%s, primary_position)
            where id = %s
            """,
            (name, position_name, mapped),
        )
        return mapped
    row = execute_one(
        cur,
        "insert into core.players (display_name, primary_position, metadata) values (%s, %s, %s) returning id",
        (name, position_name, Jsonb({"365_country_id": country_id} if country_id is not None else {})),
    )
    assert row is not None
    player_id = row["id"]
    upsert_mapping(cur, source_id, "player", source_player_id, "core.players", player_id, name, slugify(name))
    return player_id


def get_or_create_metric(cur: psycopg.Cursor, code: str, subject_type: str, value_type: str = "count") -> str:
    row = execute_one(
        cur,
        """
        insert into obs.metrics (code, name, subject_type, value_type)
        values (%s, %s, %s, %s)
        on conflict (code) do update
          set name = excluded.name,
              subject_type = excluded.subject_type,
              value_type = excluded.value_type
        returning id
        """,
        (code, metric_name(code), subject_type, value_type),
    )
    assert row is not None
    return row["id"]


def source_player_id(row: dict[str, str]) -> Optional[str]:
    return empty_to_none(row.get("athlete_id")) or empty_to_none(row.get("lineup_member_id"))


def upsert_match(
    cur: psycopg.Cursor,
    source_id: str,
    season_id: str,
    stage_id: str,
    round_id: Optional[str],
    row: dict[str, str],
    home_team_id: str,
    away_team_id: str,
) -> str:
    source_match_id = row["game_id"]
    mapped = get_mapping(cur, source_id, "match", source_match_id)
    if mapped:
        cur.execute(
            """
            update core.matches
            set season_id = %s,
                stage_id = %s,
                round_id = %s,
                scheduled_at = %s,
                status = %s,
                home_team_id = %s,
                away_team_id = %s,
                home_score = %s,
                away_score = %s,
                updated_at = now()
            where id = %s
            """,
            (
                season_id,
                stage_id,
                round_id,
                row.get("start_time"),
                row.get("status_text"),
                home_team_id,
                away_team_id,
                to_int(row.get("home_score")),
                to_int(row.get("away_score")),
                mapped,
            ),
        )
        return mapped
    match = execute_one(
        cur,
        """
        insert into core.matches (
          season_id, stage_id, round_id, scheduled_at, status,
          home_team_id, away_team_id, home_score, away_score
        )
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        returning id
        """,
        (
            season_id,
            stage_id,
            round_id,
            row.get("start_time"),
            row.get("status_text"),
            home_team_id,
            away_team_id,
            to_int(row.get("home_score")),
            to_int(row.get("away_score")),
        ),
    )
    assert match is not None
    match_id = match["id"]
    upsert_mapping(cur, source_id, "match", source_match_id, "core.matches", match_id)
    return match_id


def upsert_match_team(
    cur: psycopg.Cursor,
    match_id: str,
    team_id: str,
    opponent_team_id: str,
    side: str,
    score: Optional[int],
) -> str:
    row = execute_one(
        cur,
        """
        insert into core.match_teams (match_id, team_id, opponent_team_id, side, score)
        values (%s, %s, %s, %s, %s)
        on conflict (match_id, team_id) do update
          set opponent_team_id = excluded.opponent_team_id,
              side = excluded.side,
              score = excluded.score
        returning id
        """,
        (match_id, team_id, opponent_team_id, side, score),
    )
    assert row is not None
    return row["id"]


def upsert_appearance(
    cur: psycopg.Cursor,
    match_id: str,
    player_id: str,
    team_id: str,
    opponent_team_id: str,
    row: dict[str, str],
) -> str:
    appearance = execute_one(
        cur,
        """
        insert into core.player_match_appearances (
          match_id, player_id, team_id, opponent_team_id, side, shirt_number,
          lineup_status, position_name, formation_position, minutes_played
        )
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (match_id, player_id, team_id) do update
          set opponent_team_id = excluded.opponent_team_id,
              side = excluded.side,
              shirt_number = excluded.shirt_number,
              lineup_status = excluded.lineup_status,
              position_name = excluded.position_name,
              formation_position = excluded.formation_position,
              minutes_played = excluded.minutes_played
        returning id
        """,
        (
            match_id,
            player_id,
            team_id,
            opponent_team_id,
            row.get("team_side"),
            to_int(row.get("jersey_number")),
            row.get("lineup_status_text"),
            row.get("position_name"),
            row.get("formation_name"),
            to_float(row.get("stat_minutes_value")),
        ),
    )
    assert appearance is not None
    return appearance["id"]


def replace_stat_observation(
    cur: psycopg.Cursor,
    source_id: str,
    metric_id: str,
    subject_type: str,
    subject_id: str,
    source_subject_id: str,
    source_metric_name: str,
    value: Optional[float],
    raw_value: Optional[str],
    match_id: Optional[str] = None,
    team_id: Optional[str] = None,
    player_id: Optional[str] = None,
    season_id: Optional[str] = None,
) -> None:
    if value is None and raw_value is None:
        return
    cur.execute(
        """
        insert into obs.stat_observations (
          source_id, metric_id, subject_type, subject_id, match_id, team_id,
          player_id, season_id, source_subject_id, source_metric_name,
          value_numeric, raw_value
        )
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (source_id, subject_type, subject_id, metric_id) do update
          set match_id = excluded.match_id,
              team_id = excluded.team_id,
              player_id = excluded.player_id,
              season_id = excluded.season_id,
              source_subject_id = excluded.source_subject_id,
              source_metric_name = excluded.source_metric_name,
              value_numeric = excluded.value_numeric,
              raw_value = excluded.raw_value,
              observed_at = now()
        """,
        (
            source_id,
            metric_id,
            subject_type,
            subject_id,
            match_id,
            team_id,
            player_id,
            season_id,
            source_subject_id,
            source_metric_name,
            value,
            raw_value,
        ),
    )


def load_fixtures(cur: psycopg.Cursor, source_id: str, competition_id: str, season_id: str, rows: list[dict[str, str]]) -> dict[str, Any]:
    teams: dict[str, str] = {}
    matches: dict[str, str] = {}
    match_teams: dict[tuple[str, str], str] = {}

    for row in rows:
        home_source_id = row["home_team_id"]
        away_source_id = row["away_team_id"]
        teams[home_source_id] = get_or_create_team(cur, source_id, home_source_id, row["home_team"])
        teams[away_source_id] = get_or_create_team(cur, source_id, away_source_id, row["away_team"])

        stage_id = get_or_create_stage(cur, season_id, to_int(row.get("stage_num")))
        round_id = get_or_create_round(cur, stage_id, to_int(row.get("round_num")), row.get("round_name"))
        match_id = upsert_match(
            cur,
            source_id,
            season_id,
            stage_id,
            round_id,
            row,
            teams[home_source_id],
            teams[away_source_id],
        )
        matches[row["game_id"]] = match_id
        match_teams[(row["game_id"], home_source_id)] = upsert_match_team(
            cur,
            match_id,
            teams[home_source_id],
            teams[away_source_id],
            "home",
            to_int(row.get("home_score")),
        )
        match_teams[(row["game_id"], away_source_id)] = upsert_match_team(
            cur,
            match_id,
            teams[away_source_id],
            teams[home_source_id],
            "away",
            to_int(row.get("away_score")),
        )
        cur.execute(
            """
            insert into obs.match_observations (
              source_id, match_id, source_match_id, scheduled_at, status,
              home_source_team_id, away_source_team_id, home_score, away_score, round_name
            )
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (source_id, source_match_id) do update
              set match_id = excluded.match_id,
                  scheduled_at = excluded.scheduled_at,
                  status = excluded.status,
                  home_source_team_id = excluded.home_source_team_id,
                  away_source_team_id = excluded.away_source_team_id,
                  home_score = excluded.home_score,
                  away_score = excluded.away_score,
                  round_name = excluded.round_name,
                  observed_at = now()
            """,
            (
                source_id,
                match_id,
                row["game_id"],
                row.get("start_time"),
                row.get("status_text"),
                home_source_id,
                away_source_id,
                to_int(row.get("home_score")),
                to_int(row.get("away_score")),
                row.get("round_name"),
            ),
        )

    return {"teams": teams, "matches": matches, "match_teams": match_teams, "competition_id": competition_id}


def load_player_rows(
    cur: psycopg.Cursor,
    source_id: str,
    season_id: str,
    rows: list[dict[str, str]],
    indexes: dict[str, Any],
) -> None:
    metric_ids: dict[str, str] = {}

    for row in rows:
        player_source_id = source_player_id(row)
        if not player_source_id:
            continue
        match_id = indexes["matches"].get(row["game_id"])
        team_id = indexes["teams"].get(row["team_id"])
        opponent_team_id = indexes["teams"].get(row["opponent_id"])
        if not match_id or not team_id or not opponent_team_id:
            continue

        player_id = get_or_create_player(
            cur,
            source_id,
            player_source_id,
            row["player_name"],
            to_int(row.get("country_id")),
            row.get("position_name"),
        )
        appearance_id = upsert_appearance(cur, match_id, player_id, team_id, opponent_team_id, row)

        cur.execute(
            """
            insert into obs.player_appearance_observations (
              source_id, appearance_id, match_id, player_id, team_id,
              source_match_id, source_player_id, source_team_id,
              lineup_status, position_name, formation_name, shirt_number, rating, heatmap_url
            )
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (source_id, source_match_id, source_player_id) do update
              set appearance_id = excluded.appearance_id,
                  match_id = excluded.match_id,
                  player_id = excluded.player_id,
                  team_id = excluded.team_id,
                  source_team_id = excluded.source_team_id,
                  lineup_status = excluded.lineup_status,
                  position_name = excluded.position_name,
                  formation_name = excluded.formation_name,
                  shirt_number = excluded.shirt_number,
                  rating = excluded.rating,
                  heatmap_url = excluded.heatmap_url,
                  observed_at = now()
            """,
            (
                source_id,
                appearance_id,
                match_id,
                player_id,
                team_id,
                row["game_id"],
                player_source_id,
                row["team_id"],
                row.get("lineup_status_text"),
                row.get("position_name"),
                row.get("formation_name"),
                to_int(row.get("jersey_number")),
                to_float(row.get("rating")),
                row.get("heatmap_url"),
            ),
        )

        source_subject_id = f"{row['game_id']}:{player_source_id}:{row['team_id']}"
        if row.get("rating"):
            metric_ids.setdefault("rating_365", get_or_create_metric(cur, "rating_365", "player_match", "rating"))
            replace_stat_observation(
                cur,
                source_id,
                metric_ids["rating_365"],
                "player_match",
                appearance_id,
                source_subject_id,
                "365 rating",
                to_float(row.get("rating")),
                row.get("rating"),
                match_id,
                team_id,
                player_id,
                season_id,
            )

        stat_bases = sorted({metric_from_stat_column(column) for column in row.keys() if metric_from_stat_column(column)})
        for base in stat_bases:
            raw_value = row.get(f"stat_{base}_raw")
            value = to_float(row.get(f"stat_{base}_value"))
            attempted = to_float(row.get(f"stat_{base}_attempted"))
            percentage = to_float(row.get(f"stat_{base}_percentage"))

            metric_ids.setdefault(base, get_or_create_metric(cur, base, "player_match"))
            replace_stat_observation(
                cur,
                source_id,
                metric_ids[base],
                "player_match",
                appearance_id,
                source_subject_id,
                base,
                value,
                raw_value,
                match_id,
                team_id,
                player_id,
                season_id,
            )

            if attempted is not None:
                attempted_code = attempted_metric_code(base)
                metric_ids.setdefault(attempted_code, get_or_create_metric(cur, attempted_code, "player_match"))
                replace_stat_observation(
                    cur,
                    source_id,
                    metric_ids[attempted_code],
                    "player_match",
                    appearance_id,
                    source_subject_id,
                    f"{base}_attempted",
                    attempted,
                    raw_value,
                    match_id,
                    team_id,
                    player_id,
                    season_id,
                )

            if percentage is not None:
                percentage_code = percentage_metric_code(base)
                metric_ids.setdefault(
                    percentage_code,
                    get_or_create_metric(cur, percentage_code, "player_match", "percentage"),
                )
                replace_stat_observation(
                    cur,
                    source_id,
                    metric_ids[percentage_code],
                    "player_match",
                    appearance_id,
                    source_subject_id,
                    f"{base}_percentage",
                    percentage,
                    raw_value,
                    match_id,
                    team_id,
                    player_id,
                    season_id,
                )


def parse_team_stat_value(value: str, value_percentage: str) -> tuple[Optional[float], str]:
    raw = value or value_percentage
    if value_percentage:
        try:
            return float(value_percentage) * 100, raw
        except ValueError:
            pass
    if not value:
        return None, raw
    text = value.replace("%", "").strip()
    if "/" in text:
        text = text.split("/", 1)[0].strip()
    try:
        return float(text), raw
    except ValueError:
        return None, raw


def load_team_stats(
    cur: psycopg.Cursor,
    source_id: str,
    season_id: str,
    rows: list[dict[str, str]],
    indexes: dict[str, Any],
) -> None:
    metric_ids: dict[str, str] = {}
    for row in rows:
        match_id = indexes["matches"].get(row["game_id"])
        team_id = indexes["teams"].get(row["team_id"])
        match_team_id = indexes["match_teams"].get((row["game_id"], row["team_id"]))
        if not match_id or not team_id or not match_team_id or not row.get("stat_name"):
            continue
        code = slugify(row["stat_name"])
        value, raw = parse_team_stat_value(row.get("value", ""), row.get("value_percentage", ""))
        value_type = "percentage" if row.get("value_percentage") or "%" in row.get("value", "") else "count"
        metric_ids.setdefault(code, get_or_create_metric(cur, code, "team_match", value_type))
        replace_stat_observation(
            cur,
            source_id,
            metric_ids[code],
            "team_match",
            match_team_id,
            f"{row['game_id']}:{row['team_id']}",
            row["stat_name"],
            value,
            raw,
            match_id=match_id,
            team_id=team_id,
            season_id=season_id,
        )


def main() -> int:
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    fixture_rows = read_csv(PROCESSED_DIR / "365scores_fixtures.csv")
    player_rows = read_csv(PROCESSED_DIR / "365scores_player_match_stats.csv")
    team_stat_rows = read_csv(PROCESSED_DIR / "365scores_team_match_stats.csv")

    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            source_id = get_source(cur)
            country_id = get_or_create_country(cur)
            competition_id = get_or_create_competition(cur, source_id, country_id)
            season_id = get_or_create_season(cur, source_id, competition_id, fixture_rows)
            indexes = load_fixtures(cur, source_id, competition_id, season_id, fixture_rows)
            load_player_rows(cur, source_id, season_id, player_rows, indexes)
            load_team_stats(cur, source_id, season_id, team_stat_rows, indexes)
        conn.commit()

    print(
        "loaded "
        f"{len(fixture_rows)} fixtures, "
        f"{len(player_rows)} player-match rows, "
        f"{len(team_stat_rows)} team-stat rows"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
