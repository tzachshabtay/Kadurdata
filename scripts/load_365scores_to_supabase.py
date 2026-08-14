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
STAT_BATCH_SIZE = 1000
STAT_OBSERVATION_SQL = """
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
"""


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
    cur.execute(STAT_OBSERVATION_SQL, stat_observation_params(
        source_id,
        metric_id,
        subject_type,
        subject_id,
        source_subject_id,
        source_metric_name,
        value,
        raw_value,
        match_id,
        team_id,
        player_id,
        season_id,
    ))


def stat_observation_params(
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
) -> Optional[tuple[Any, ...]]:
    if value is None and raw_value is None:
        return None
    return (
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
    )


def flush_stat_batch(cur: psycopg.Cursor, batch: list[tuple[Any, ...]]) -> int:
    if not batch:
        return 0
    cur.execute(
        """
        create temp table if not exists stat_observation_stage (
          source_id uuid not null,
          metric_id uuid not null,
          subject_type text not null,
          subject_id uuid,
          match_id uuid,
          team_id uuid,
          player_id uuid,
          season_id uuid,
          source_subject_id text,
          source_metric_name text,
          value_numeric numeric(18,6),
          raw_value text
        ) on commit preserve rows
        """
    )
    cur.execute("truncate stat_observation_stage")
    with cur.copy(
        """
        copy stat_observation_stage (
          source_id, metric_id, subject_type, subject_id, match_id, team_id,
          player_id, season_id, source_subject_id, source_metric_name,
          value_numeric, raw_value
        ) from stdin
        """
    ) as copy:
        for row in batch:
            copy.write_row(row)
    cur.execute(
        """
        insert into obs.stat_observations (
          source_id, metric_id, subject_type, subject_id, match_id, team_id,
          player_id, season_id, source_subject_id, source_metric_name,
          value_numeric, raw_value
        )
        select
          source_id, metric_id, subject_type, subject_id, match_id, team_id,
          player_id, season_id, source_subject_id, source_metric_name,
          value_numeric, raw_value
        from stat_observation_stage
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
        """
    )
    count = len(batch)
    batch.clear()
    return count


def collect_player_stat_metric_specs(rows: list[dict[str, str]]) -> dict[str, tuple[str, str]]:
    specs: dict[str, tuple[str, str]] = {}
    if any(row.get("rating") for row in rows):
        specs["rating_365"] = ("player_match", "rating")
    for row in rows:
        for base in {metric_from_stat_column(column) for column in row.keys() if metric_from_stat_column(column)}:
            raw_value = row.get(f"stat_{base}_raw")
            if to_float(row.get(f"stat_{base}_value")) is not None or raw_value:
                specs.setdefault(base, ("player_match", "count"))
            if to_float(row.get(f"stat_{base}_attempted")) is not None:
                specs.setdefault(attempted_metric_code(base), ("player_match", "count"))
            if to_float(row.get(f"stat_{base}_percentage")) is not None:
                specs.setdefault(percentage_metric_code(base), ("player_match", "percentage"))
    return specs


def ensure_metrics(cur: psycopg.Cursor, specs: dict[str, tuple[str, str]]) -> dict[str, str]:
    if not specs:
        return {}
    cur.execute(
        """
        create temp table if not exists metric_stage (
          code text primary key,
          name text not null,
          subject_type text not null,
          value_type text not null
        ) on commit preserve rows
        """
    )
    cur.execute("truncate metric_stage")
    with cur.copy("copy metric_stage (code, name, subject_type, value_type) from stdin") as copy:
        for code, (subject_type, value_type) in sorted(specs.items()):
            copy.write_row((code, metric_name(code), subject_type, value_type))
    cur.execute(
        """
        insert into obs.metrics (code, name, subject_type, value_type)
        select code, name, subject_type, value_type
        from metric_stage
        on conflict (code) do update
          set name = excluded.name,
              subject_type = excluded.subject_type,
              value_type = excluded.value_type
        """
    )
    cur.execute(
        """
        select m.code, m.id
        from obs.metrics m
        join metric_stage s on s.code = m.code
        """
    )
    return {row["code"]: row["id"] for row in cur.fetchall()}


def valid_player_rows(rows: list[dict[str, str]], indexes: dict[str, Any]) -> list[dict[str, Any]]:
    valid: list[dict[str, Any]] = []
    for row in rows:
        player_source_id = source_player_id(row)
        if not player_source_id:
            continue
        match_id = indexes["matches"].get(row["game_id"])
        team_id = indexes["teams"].get(row["team_id"])
        opponent_team_id = indexes["teams"].get(row["opponent_id"])
        if not match_id or not team_id or not opponent_team_id:
            continue
        valid.append(
            {
                "row": row,
                "source_player_id": player_source_id,
                "match_id": match_id,
                "team_id": team_id,
                "opponent_team_id": opponent_team_id,
            }
        )
    return valid


def ensure_players(cur: psycopg.Cursor, source_id: str, rows: list[dict[str, Any]]) -> dict[str, str]:
    unique_players: dict[str, dict[str, Any]] = {}
    for item in rows:
        row = item["row"]
        unique_players.setdefault(
            item["source_player_id"],
            {
                "source_player_id": item["source_player_id"],
                "name": row["player_name"],
                "country_id": to_int(row.get("country_id")),
                "position_name": row.get("position_name"),
            },
        )
    if not unique_players:
        return {}

    cur.execute(
        """
        create temp table if not exists player_stage (
          source_player_id text primary key,
          name text not null,
          country_id integer,
          position_name text
        ) on commit preserve rows
        """
    )
    cur.execute("truncate player_stage")
    with cur.copy("copy player_stage (source_player_id, name, country_id, position_name) from stdin") as copy:
        for item in unique_players.values():
            copy.write_row((item["source_player_id"], item["name"], item["country_id"], item["position_name"]))

    cur.execute(
        """
        update core.players p
        set display_name = s.name,
            primary_position = coalesce(s.position_name, p.primary_position)
        from source.source_entity_ids m
        join player_stage s on s.source_player_id = m.source_entity_id
        where m.source_id = %s
          and m.entity_type = 'player'
          and p.id = m.canonical_id
        """,
        (source_id,),
    )
    cur.execute(
        """
        with new_players as (
          select s.*
          from player_stage s
          left join source.source_entity_ids m
            on m.source_id = %s
           and m.entity_type = 'player'
           and m.source_entity_id = s.source_player_id
          where m.id is null
        ),
        inserted as (
          insert into core.players (display_name, primary_position, metadata)
          select
            name,
            position_name,
            jsonb_build_object(
              '365_country_id', country_id,
              '365_source_player_id', source_player_id
            )
          from new_players
          returning id, display_name, metadata
        )
        insert into source.source_entity_ids (
          source_id, entity_type, source_entity_id, canonical_table, canonical_id,
          source_name, last_seen_at
        )
        select
          %s,
          'player',
          metadata->>'365_source_player_id',
          'core.players',
          id,
          display_name,
          now()
        from inserted
        on conflict (source_id, entity_type, source_entity_id) do update
          set canonical_table = excluded.canonical_table,
              canonical_id = excluded.canonical_id,
              source_name = excluded.source_name,
              last_seen_at = now()
        """,
        (source_id, source_id),
    )
    cur.execute(
        """
        select m.source_entity_id, m.canonical_id
        from source.source_entity_ids m
        join player_stage s on s.source_player_id = m.source_entity_id
        where m.source_id = %s
          and m.entity_type = 'player'
        """,
        (source_id,),
    )
    return {row["source_entity_id"]: row["canonical_id"] for row in cur.fetchall()}


def ensure_appearances(
    cur: psycopg.Cursor,
    source_id: str,
    rows: list[dict[str, Any]],
    player_ids: dict[str, str],
) -> dict[tuple[str, str, str], str]:
    cur.execute(
        """
        create temp table if not exists appearance_stage (
          source_match_id text not null,
          source_player_id text not null,
          source_team_id text not null,
          match_id uuid not null,
          player_id uuid not null,
          team_id uuid not null,
          opponent_team_id uuid not null,
          side text,
          shirt_number integer,
          lineup_status text,
          position_name text,
          formation_position text,
          minutes_played numeric(5,2),
          rating numeric(6,3),
          heatmap_url text,
          primary key (source_match_id, source_player_id, source_team_id)
        ) on commit preserve rows
        """
    )
    cur.execute("truncate appearance_stage")
    with cur.copy(
        """
        copy appearance_stage (
          source_match_id, source_player_id, source_team_id, match_id, player_id,
          team_id, opponent_team_id, side, shirt_number, lineup_status,
          position_name, formation_position, minutes_played, rating, heatmap_url
        ) from stdin
        """
    ) as copy:
        for item in rows:
            row = item["row"]
            player_id = player_ids.get(item["source_player_id"])
            if not player_id:
                continue
            copy.write_row(
                (
                    row["game_id"],
                    item["source_player_id"],
                    row["team_id"],
                    item["match_id"],
                    player_id,
                    item["team_id"],
                    item["opponent_team_id"],
                    row.get("team_side"),
                    to_int(row.get("jersey_number")),
                    row.get("lineup_status_text"),
                    row.get("position_name"),
                    row.get("formation_name"),
                    to_float(row.get("stat_minutes_value")),
                    to_float(row.get("rating")),
                    row.get("heatmap_url"),
                )
            )

    cur.execute(
        """
        insert into core.player_match_appearances (
          match_id, player_id, team_id, opponent_team_id, side, shirt_number,
          lineup_status, position_name, formation_position, minutes_played
        )
        select
          match_id, player_id, team_id, opponent_team_id, side, shirt_number,
          lineup_status, position_name, formation_position, minutes_played
        from appearance_stage
        on conflict (match_id, player_id, team_id) do update
          set opponent_team_id = excluded.opponent_team_id,
              side = excluded.side,
              shirt_number = excluded.shirt_number,
              lineup_status = excluded.lineup_status,
              position_name = excluded.position_name,
              formation_position = excluded.formation_position,
              minutes_played = excluded.minutes_played
        """
    )
    cur.execute(
        """
        insert into obs.player_appearance_observations (
          source_id, appearance_id, match_id, player_id, team_id,
          source_match_id, source_player_id, source_team_id,
          lineup_status, position_name, formation_name, shirt_number, rating, heatmap_url
        )
        select
          %s,
          pma.id,
          s.match_id,
          s.player_id,
          s.team_id,
          s.source_match_id,
          s.source_player_id,
          s.source_team_id,
          s.lineup_status,
          s.position_name,
          s.formation_position,
          s.shirt_number,
          s.rating,
          s.heatmap_url
        from appearance_stage s
        join core.player_match_appearances pma
          on pma.match_id = s.match_id
         and pma.player_id = s.player_id
         and pma.team_id = s.team_id
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
        (source_id,),
    )
    cur.execute(
        """
        select
          s.source_match_id,
          s.source_player_id,
          s.source_team_id,
          pma.id
        from appearance_stage s
        join core.player_match_appearances pma
          on pma.match_id = s.match_id
         and pma.player_id = s.player_id
         and pma.team_id = s.team_id
        """
    )
    return {
        (row["source_match_id"], row["source_player_id"], row["source_team_id"]): row["id"]
        for row in cur.fetchall()
    }


def load_fixtures(cur: psycopg.Cursor, source_id: str, competition_id: str, season_id: str, rows: list[dict[str, str]]) -> dict[str, Any]:
    teams: dict[str, str] = {}
    matches: dict[str, str] = {}
    match_teams: dict[tuple[str, str], str] = {}
    stages: dict[Optional[int], str] = {}
    rounds: dict[tuple[str, Optional[int], Optional[str]], Optional[str]] = {}

    for row in rows:
        home_source_id = row["home_team_id"]
        away_source_id = row["away_team_id"]
        if home_source_id not in teams:
            teams[home_source_id] = get_or_create_team(cur, source_id, home_source_id, row["home_team"])
        if away_source_id not in teams:
            teams[away_source_id] = get_or_create_team(cur, source_id, away_source_id, row["away_team"])

        stage_num = to_int(row.get("stage_num"))
        if stage_num not in stages:
            stages[stage_num] = get_or_create_stage(cur, season_id, stage_num)
        stage_id = stages[stage_num]
        round_num = to_int(row.get("round_num"))
        round_key = (stage_id, round_num, row.get("round_name"))
        if round_key not in rounds:
            rounds[round_key] = get_or_create_round(cur, stage_id, round_num, row.get("round_name"))
        round_id = rounds[round_key]
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
    conn: psycopg.Connection,
    cur: psycopg.Cursor,
    source_id: str,
    season_id: str,
    rows: list[dict[str, str]],
    indexes: dict[str, Any],
) -> None:
    valid_rows = valid_player_rows(rows, indexes)
    metric_ids = ensure_metrics(cur, collect_player_stat_metric_specs([item["row"] for item in valid_rows]))
    player_ids = ensure_players(cur, source_id, valid_rows)
    appearance_ids = ensure_appearances(cur, source_id, valid_rows, player_ids)
    stat_batch: list[tuple[Any, ...]] = []
    written_stats = 0

    print(
        f"prepared {len(player_ids)} players and {len(appearance_ids)} player appearances",
        flush=True,
    )

    for index, item in enumerate(valid_rows, start=1):
        row = item["row"]
        player_source_id = item["source_player_id"]
        player_id = player_ids.get(player_source_id)
        appearance_id = appearance_ids.get((row["game_id"], player_source_id, row["team_id"]))
        if not player_id or not appearance_id:
            continue

        source_subject_id = f"{row['game_id']}:{player_source_id}:{row['team_id']}"
        if row.get("rating"):
            params = stat_observation_params(
                source_id,
                metric_ids["rating_365"],
                "player_match",
                appearance_id,
                source_subject_id,
                "365 rating",
                to_float(row.get("rating")),
                row.get("rating"),
                item["match_id"],
                item["team_id"],
                player_id,
                season_id,
            )
            if params:
                stat_batch.append(params)

        stat_bases = sorted({metric_from_stat_column(column) for column in row.keys() if metric_from_stat_column(column)})
        for base in stat_bases:
            raw_value = row.get(f"stat_{base}_raw")
            value = to_float(row.get(f"stat_{base}_value"))
            attempted = to_float(row.get(f"stat_{base}_attempted"))
            percentage = to_float(row.get(f"stat_{base}_percentage"))

            params = stat_observation_params(
                source_id,
                metric_ids[base],
                "player_match",
                appearance_id,
                source_subject_id,
                base,
                value,
                raw_value,
                item["match_id"],
                item["team_id"],
                player_id,
                season_id,
            )
            if params:
                stat_batch.append(params)

            if attempted is not None:
                attempted_code = attempted_metric_code(base)
                params = stat_observation_params(
                    source_id,
                    metric_ids[attempted_code],
                    "player_match",
                    appearance_id,
                    source_subject_id,
                    f"{base}_attempted",
                    attempted,
                    raw_value,
                    item["match_id"],
                    item["team_id"],
                    player_id,
                    season_id,
                )
                if params:
                    stat_batch.append(params)

            if percentage is not None:
                percentage_code = percentage_metric_code(base)
                params = stat_observation_params(
                    source_id,
                    metric_ids[percentage_code],
                    "player_match",
                    appearance_id,
                    source_subject_id,
                    f"{base}_percentage",
                    percentage,
                    raw_value,
                    item["match_id"],
                    item["team_id"],
                    player_id,
                    season_id,
                )
                if params:
                    stat_batch.append(params)

        if len(stat_batch) >= STAT_BATCH_SIZE:
            written_stats += flush_stat_batch(cur, stat_batch)
        if index % 500 == 0:
            written_stats += flush_stat_batch(cur, stat_batch)
            conn.commit()
            print(f"processed {index}/{len(valid_rows)} player rows; wrote {written_stats} stat observations", flush=True)

    written_stats += flush_stat_batch(cur, stat_batch)
    print(f"processed {len(valid_rows)} player rows; wrote {written_stats} player stat observations", flush=True)


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


def team_metric_code(source_stat_name: str) -> str:
    return f"team_{slugify(source_stat_name)}"


def collect_team_stat_metric_specs(rows: list[dict[str, str]]) -> dict[str, tuple[str, str]]:
    specs: dict[str, tuple[str, str]] = {}
    for row in rows:
        if not row.get("stat_name"):
            continue
        code = team_metric_code(row["stat_name"])
        value_type = "percentage" if row.get("value_percentage") or "%" in row.get("value", "") else "count"
        specs.setdefault(code, ("team_match", value_type))
    return specs


def load_team_stats(
    conn: psycopg.Connection,
    cur: psycopg.Cursor,
    source_id: str,
    season_id: str,
    rows: list[dict[str, str]],
    indexes: dict[str, Any],
) -> None:
    metric_ids = ensure_metrics(cur, collect_team_stat_metric_specs(rows))
    stat_batch: list[tuple[Any, ...]] = []
    written_stats = 0
    for row in rows:
        match_id = indexes["matches"].get(row["game_id"])
        team_id = indexes["teams"].get(row["team_id"])
        match_team_id = indexes["match_teams"].get((row["game_id"], row["team_id"]))
        if not match_id or not team_id or not match_team_id or not row.get("stat_name"):
            continue
        code = team_metric_code(row["stat_name"])
        value, raw = parse_team_stat_value(row.get("value", ""), row.get("value_percentage", ""))
        params = stat_observation_params(
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
        if params:
            stat_batch.append(params)
        if len(stat_batch) >= STAT_BATCH_SIZE:
            written_stats += flush_stat_batch(cur, stat_batch)
    written_stats += flush_stat_batch(cur, stat_batch)
    conn.commit()
    print(f"processed {len(rows)} team-stat rows; wrote {written_stats} team stat observations", flush=True)


def main() -> int:
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    fixture_rows = read_csv(PROCESSED_DIR / "365scores_fixtures.csv")
    player_rows = read_csv(PROCESSED_DIR / "365scores_player_match_stats.csv")
    team_stat_rows = read_csv(PROCESSED_DIR / "365scores_team_match_stats.csv")

    with psycopg.connect(database_url, row_factory=dict_row, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            source_id = get_source(cur)
            print("source ready", flush=True)
            country_id = get_or_create_country(cur)
            competition_id = get_or_create_competition(cur, source_id, country_id)
            season_id = get_or_create_season(cur, source_id, competition_id, fixture_rows)
            print("core competition objects ready", flush=True)
            indexes = load_fixtures(cur, source_id, competition_id, season_id, fixture_rows)
            conn.commit()
            print(f"loaded fixture graph for {len(indexes['matches'])} matches", flush=True)
            load_player_rows(conn, cur, source_id, season_id, player_rows, indexes)
            load_team_stats(conn, cur, source_id, season_id, team_stat_rows, indexes)
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
