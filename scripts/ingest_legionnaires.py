#!/usr/bin/env python3
"""Discover Israeli players abroad and fetch their foreign-league match data."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from .ingest_365scores import (
        DEFAULT_APP_TYPE_ID,
        DEFAULT_END_DATE,
        DEFAULT_LANG_ID,
        DEFAULT_START_DATE,
        DEFAULT_TIMEZONE,
        DEFAULT_USER_COUNTRY_ID,
        FOOTBALL_SPORT_ID,
        ISRAEL_COUNTRY_ID,
        base_game_row,
        build_url,
        cached_fetch,
        collect_fixture_feed,
        collect_match_payloads,
        competition_seasons,
        ensure_dir,
        flatten_player_match_rows,
        flatten_shot_events,
        flatten_team_stats,
        game_date,
        game_is_in_window,
        normalize_competition,
        team_logo_url,
        team_name,
        write_csv,
        write_json,
    )
except ImportError:
    from ingest_365scores import (
        DEFAULT_APP_TYPE_ID,
        DEFAULT_END_DATE,
        DEFAULT_LANG_ID,
        DEFAULT_START_DATE,
        DEFAULT_TIMEZONE,
        DEFAULT_USER_COUNTRY_ID,
        FOOTBALL_SPORT_ID,
        ISRAEL_COUNTRY_ID,
        base_game_row,
        build_url,
        cached_fetch,
        collect_fixture_feed,
        collect_match_payloads,
        competition_seasons,
        ensure_dir,
        flatten_player_match_rows,
        flatten_shot_events,
        flatten_team_stats,
        game_date,
        game_is_in_window,
        normalize_competition,
        team_logo_url,
        team_name,
        write_csv,
        write_json,
    )


SOURCE_CODE = "365scores"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch league data for known Israeli footballers abroad.")
    parser.add_argument("--start-date", default=DEFAULT_START_DATE)
    parser.add_argument("--end-date", default=DEFAULT_END_DATE)
    parser.add_argument("--lang-id", type=int, default=DEFAULT_LANG_ID)
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--user-country-id", type=int, default=DEFAULT_USER_COUNTRY_ID)
    parser.add_argument("--app-type-id", type=int, default=DEFAULT_APP_TYPE_ID)
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw/365scores/legionnaires"))
    parser.add_argument("--processed-dir", type=Path, default=Path("data/processed/legionnaires"))
    parser.add_argument("--profile-batch-size", type=int, default=100)
    parser.add_argument("--athlete-game-limit", type=int, default=100)
    parser.add_argument("--limit", type=int, default=0, help="Limit matches per foreign club.")
    parser.add_argument("--walk-pages", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--max-fixture-pages", type=int, default=50)
    parser.add_argument("--sleep", type=float, default=0.25)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--page-retries", type=int, default=1)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--fixtures-only", action="store_true")
    parser.add_argument(
        "--athlete-games-only",
        action="store_true",
        help="Skip club fixture feeds and use the player game histories for an incremental backfill.",
    )
    parser.add_argument(
        "--missing-details-only",
        action="store_true",
        help="Fetch completed match details only when no 365Scores player stats are stored yet.",
    )
    parser.add_argument("--allow-fetch-failures", action="store_true")
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def known_israeli_athlete_ids(database_url: str) -> list[int]:
    import psycopg

    query = """
      select distinct mapping.source_entity_id
      from source.source_entity_ids mapping
      join source.sources source on source.id = mapping.source_id
      join core.players player on player.id = mapping.canonical_id
      left join core.countries country on country.id = player.country_id
      where source.code = %s
        and mapping.entity_type = 'player'
        and (
          country.iso2 = 'IL'
          or player.metadata ->> 'source_country_id' = %s
          or player.metadata ->> '365_country_id' = %s
        )
    """
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            query,
            (SOURCE_CODE, str(ISRAEL_COUNTRY_ID), str(ISRAEL_COUNTRY_ID)),
        ).fetchall()
    return sorted({int(row[0]) for row in rows if str(row[0]).isdigit()})


def known_legionnaire_athlete_ids(database_url: str) -> set[int]:
    import psycopg

    query = """
      select distinct mapping.source_entity_id
      from source.source_entity_ids mapping
      join source.sources source on source.id = mapping.source_id
      join core.player_team_stints stint on stint.player_id = mapping.canonical_id
      join core.seasons season on season.id = stint.season_id
      join core.competitions competition on competition.id = season.competition_id
      where source.code = %s
        and mapping.entity_type = 'player'
        and competition.metadata ->> 'scope' = 'foreign_club'
    """
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(query, (SOURCE_CODE,)).fetchall()
    return {int(row[0]) for row in rows if str(row[0]).isdigit()}


def known_match_ids_with_player_stats(database_url: str) -> set[int]:
    import psycopg

    query = """
      select distinct match_mapping.source_entity_id
      from source.source_entity_ids match_mapping
      join source.sources source
        on source.id = match_mapping.source_id
       and source.code = %s
      join core.matches season_match on season_match.id = match_mapping.canonical_id
      join core.player_match_appearances appearance on appearance.match_id = season_match.id
      join obs.player_match_stats stats
        on stats.appearance_id = appearance.id
       and stats.source_id = source.id
      where match_mapping.entity_type = 'match'
    """
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(query, (SOURCE_CODE,)).fetchall()
    return {int(row[0]) for row in rows if str(row[0]).isdigit()}


def chunked(values: list[int], size: int) -> list[list[int]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def completed_games(games: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [game for game in games if game.get("statusGroup") == 4]


def games_requiring_details(
    games: list[dict[str, Any]],
    loaded_match_ids: set[int],
    missing_only: bool,
) -> list[dict[str, Any]]:
    completed = completed_games(games)
    if not missing_only:
        return completed
    return [game for game in completed if int(game.get("id") or 0) not in loaded_match_ids]


def athlete_games_in_window(
    games_by_athlete: dict[int, list[dict[str, Any]]],
    competitors: dict[int, dict[str, Any]],
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    games_by_id: dict[int, dict[str, Any]] = {}
    for wrappers in games_by_athlete.values():
        for wrapper in wrappers:
            game = wrapper.get("game") or {}
            club = foreign_club_for_game(wrapper)
            club_profile = competitors.get(int(club["id"])) if club else None
            if not club_profile or not game_is_in_window(game, start_date, end_date):
                continue
            if game.get("competitionId") is None or game.get("seasonNum") is None:
                continue
            if game.get("id") is not None:
                games_by_id[int(game["id"])] = game
    return sorted(games_by_id.values(), key=lambda game: game.get("startTime") or "")


def filter_legionnaire_player_rows(
    rows: list[dict[str, Any]],
    athlete_ids: set[int],
) -> list[dict[str, Any]]:
    return [
        row
        for row in rows
        if row.get("athlete_id") is not None and int(row["athlete_id"]) in athlete_ids
    ]


def collect_athlete_profiles(
    args: argparse.Namespace,
    athlete_ids: list[int],
) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]], dict[int, dict[str, Any]]]:
    athletes: list[dict[str, Any]] = []
    competitors: dict[int, dict[str, Any]] = {}
    competitions: dict[int, dict[str, Any]] = {}

    for batch in chunked(athlete_ids, max(1, args.profile_batch_size)):
        batch_key = hashlib.sha1(",".join(map(str, batch)).encode("ascii")).hexdigest()[:12]
        payload = cached_fetch(
            build_url(
                "/web/athletes/",
                {
                    "appTypeId": args.app_type_id,
                    "langId": args.lang_id,
                    "timezoneName": args.timezone,
                    "userCountryId": args.user_country_id,
                    "athletes": ",".join(map(str, batch)),
                },
            ),
            args.raw_dir / "profiles" / f"{batch_key}.json",
            retries=args.retries,
            sleep_seconds=args.sleep,
            refresh=args.refresh,
        )
        athletes.extend(payload.get("athletes") or [])
        competitors.update(
            {
                int(item["id"]): item
                for item in payload.get("competitors") or []
                if item.get("id") is not None
            }
        )
        competitions.update(
            {
                int(item["id"]): item
                for item in payload.get("competitions") or []
                if item.get("id") is not None
            }
        )

    return athletes, competitors, competitions


def discover_legionnaires(
    athletes: list[dict[str, Any]],
    competitors: dict[int, dict[str, Any]],
    competitions: dict[int, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for athlete in athletes:
        if athlete.get("sportId") != FOOTBALL_SPORT_ID or athlete.get("nationalityId") != ISRAEL_COUNTRY_ID:
            continue
        club_id = athlete.get("clubId")
        club = competitors.get(int(club_id)) if club_id is not None else None
        if not club or club.get("countryId") == ISRAEL_COUNTRY_ID or club.get("type") != 1:
            continue
        competition_id = club.get("mainCompetitionId")
        competition = competitions.get(int(competition_id)) if competition_id is not None else None
        if not competition:
            failures.append(
                {
                    "athlete_id": athlete.get("id"),
                    "club_id": club_id,
                    "kind": "missing_main_competition",
                }
            )
            continue
        if competition.get("currentSeasonNum") is None:
            failures.append(
                {
                    "athlete_id": athlete.get("id"),
                    "club_id": club_id,
                    "kind": "missing_current_season",
                }
            )
            continue

        position = athlete.get("position") or {}
        formation = athlete.get("formationPosition") or {}
        rows.append(
            {
                "athlete_id": athlete.get("id"),
                "player_name": athlete.get("name"),
                "country_id": athlete.get("nationalityId"),
                "position_name": position.get("name"),
                "formation_position": formation.get("name"),
                "club_id": club.get("id"),
                "club_name": team_name(club),
                "club_country_id": club.get("countryId"),
                "club_logo_url": team_logo_url(club),
                "club_image_version": club.get("imageVersion"),
                "club_primary_color": club.get("color"),
                "club_secondary_color": club.get("awayColor"),
                "competition_id": competition.get("id"),
                "competition_name": competition.get("longName") or competition.get("name"),
                "season_num": competition.get("currentSeasonNum"),
                "is_current": True,
            }
        )

    rows.sort(key=lambda row: (row.get("player_name") or "", row.get("athlete_id") or 0))
    return rows, failures


def foreign_club_for_game(wrapper: dict[str, Any]) -> dict[str, Any] | None:
    game = wrapper.get("game") or {}
    related_id = wrapper.get("relatedCompetitor")
    for key in ("homeCompetitor", "awayCompetitor"):
        competitor = game.get(key) or {}
        if competitor.get("id") != related_id:
            continue
        if competitor.get("type") == 1 and competitor.get("countryId") != ISRAEL_COUNTRY_ID:
            return competitor
    return None


def is_domestic_league(competition: dict[str, Any] | None) -> bool:
    if not competition or competition.get("isInternational") is True:
        return False
    if competition.get("countryId") in {19, 54}:
        return False
    if competition.get("hasBrackets") is True:
        return False
    name = str(competition.get("name") or "").lower()
    return not any(
        token in name
        for token in (
            "cup",
            "copa",
            "coupe",
            "friendly",
            "uefa",
            "ucl",
            "champions league",
            "europa league",
            "conference league",
            "youth league",
        )
    )


def collect_athlete_games(
    args: argparse.Namespace,
    athlete_ids: list[int],
) -> tuple[dict[int, list[dict[str, Any]]], dict[int, dict[str, Any]], list[dict[str, Any]]]:
    games_by_athlete: dict[int, list[dict[str, Any]]] = {}
    competitions: dict[int, dict[str, Any]] = {}
    failures: list[dict[str, Any]] = []

    def fetch(athlete_id: int) -> tuple[int, dict[str, Any]]:
        payload = cached_fetch(
            build_url(
                "/web/athletes/games/",
                {
                    "appTypeId": args.app_type_id,
                    "langId": args.lang_id,
                    "timezoneName": args.timezone,
                    "userCountryId": args.user_country_id,
                    "athleteId": athlete_id,
                    "lastMatchLimit": args.athlete_game_limit,
                },
            ),
            args.raw_dir / "athlete_games" / f"{athlete_id}.json",
            retries=args.retries,
            sleep_seconds=args.sleep,
            refresh=args.refresh,
        )
        return athlete_id, payload

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        pending = {executor.submit(fetch, athlete_id): athlete_id for athlete_id in athlete_ids}
        for future in as_completed(pending):
            athlete_id = pending[future]
            try:
                _, payload = future.result()
            except RuntimeError as exc:
                if not args.allow_fetch_failures:
                    raise
                failures.append({"athlete_id": athlete_id, "kind": "athlete_games", "error": str(exc)})
                continue
            games_by_athlete[athlete_id] = payload.get("games") or []
            competitions.update(
                {
                    int(item["id"]): item
                    for item in payload.get("competitions") or []
                    if item.get("id") is not None
                }
            )

    return games_by_athlete, competitions, failures


def collect_competitor_profiles(
    args: argparse.Namespace,
    competitor_ids: set[int],
) -> tuple[dict[int, dict[str, Any]], dict[int, dict[str, Any]], list[dict[str, Any]]]:
    competitors: dict[int, dict[str, Any]] = {}
    competitions: dict[int, dict[str, Any]] = {}
    failures: list[dict[str, Any]] = []
    for batch in chunked(sorted(competitor_ids), max(1, args.profile_batch_size)):
        batch_key = hashlib.sha1(",".join(map(str, batch)).encode("ascii")).hexdigest()[:12]
        try:
            payload = cached_fetch(
                build_url(
                    "/web/competitors/",
                    {
                        "appTypeId": args.app_type_id,
                        "langId": args.lang_id,
                        "timezoneName": args.timezone,
                        "userCountryId": args.user_country_id,
                        "competitors": ",".join(map(str, batch)),
                    },
                ),
                args.raw_dir / "competitor_profiles" / f"{batch_key}.json",
                retries=args.retries,
                sleep_seconds=args.sleep,
                refresh=args.refresh,
            )
        except RuntimeError as exc:
            if not args.allow_fetch_failures:
                raise
            failures.append({"competitor_ids": batch, "kind": "competitor_profiles", "error": str(exc)})
            continue
        competitors.update(
            {
                int(item["id"]): item
                for item in payload.get("competitors") or []
                if item.get("id") is not None
            }
        )
        competitions.update(
            {
                int(item["id"]): item
                for item in payload.get("competitions") or []
                if item.get("id") is not None
            }
        )
    return competitors, competitions, failures


def discover_historical_affiliations(
    current_rows: list[dict[str, Any]],
    athletes: list[dict[str, Any]],
    games_by_athlete: dict[int, list[dict[str, Any]]],
    competitors: dict[int, dict[str, Any]],
    competitions: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    rows_by_key: dict[tuple[int, int, int, int], dict[str, Any]] = {}
    athletes_by_id = {
        int(athlete["id"]): athlete
        for athlete in athletes
        if athlete.get("id") is not None
    }
    candidate_athlete_ids = set(games_by_athlete)

    for row in current_rows:
        key = (
            int(row["athlete_id"]),
            int(row["club_id"]),
            int(row["competition_id"]),
            int(row["season_num"]),
        )
        rows_by_key[key] = {**row, "is_current": True}

    for athlete_id in sorted(candidate_athlete_ids):
        athlete = athletes_by_id.get(athlete_id) or {}
        position = athlete.get("position") or {}
        formation = athlete.get("formationPosition") or {}
        for wrapper in games_by_athlete.get(athlete_id, []):
            game = wrapper.get("game") or {}
            embedded_club = foreign_club_for_game(wrapper)
            if not embedded_club or game.get("seasonNum") is None:
                continue
            club = competitors.get(int(embedded_club["id"])) or embedded_club
            competition_id = game.get("competitionId")
            competition = competitions.get(int(competition_id)) if competition_id is not None else None
            is_main_competition = int(competition_id) == club.get("mainCompetitionId")
            if not is_main_competition and not is_domestic_league(competition):
                continue

            key = (athlete_id, int(club["id"]), int(competition_id), int(game["seasonNum"]))
            if key in rows_by_key:
                continue
            rows_by_key[key] = {
                "athlete_id": athlete_id,
                "player_name": athlete.get("name"),
                "country_id": athlete.get("nationalityId"),
                "position_name": position.get("name"),
                "formation_position": formation.get("name"),
                "club_id": club.get("id"),
                "club_name": team_name(club),
                "club_country_id": club.get("countryId"),
                "club_logo_url": team_logo_url(club),
                "club_image_version": club.get("imageVersion"),
                "club_primary_color": club.get("color"),
                "club_secondary_color": club.get("awayColor"),
                "competition_id": competition.get("id"),
                "competition_name": competition.get("longName") or competition.get("name"),
                "season_num": game.get("seasonNum"),
                "is_current": False,
                "observed_at": game_date(game),
            }

    return sorted(
        rows_by_key.values(),
        key=lambda row: (
            row.get("player_name") or "",
            str(row.get("season_num") or ""),
            row.get("club_name") or "",
        ),
    )


def main() -> int:
    args = parse_args()
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")
    ensure_dir(args.raw_dir)
    ensure_dir(args.processed_dir)

    athlete_ids = known_israeli_athlete_ids(database_url)
    if not athlete_ids:
        raise SystemExit("no Israeli 365Scores player mappings were found")
    print(f"resolving current clubs for {len(athlete_ids)} known Israeli players", flush=True)

    athletes, competitors, source_competitions = collect_athlete_profiles(args, athlete_ids)
    current_roster_rows, failures = discover_legionnaires(athletes, competitors, source_competitions)
    current_athlete_ids = {int(row["athlete_id"]) for row in current_roster_rows}
    historical_athlete_ids = known_legionnaire_athlete_ids(database_url)
    athlete_game_ids = sorted(current_athlete_ids | historical_athlete_ids)
    print(f"discovered {len(current_roster_rows)} active foreign-club affiliations", flush=True)
    print(f"recovering club histories for {len(athlete_game_ids)} current or prior legionnaires", flush=True)

    games_by_athlete, athlete_competitions, athlete_failures = collect_athlete_games(
        args,
        athlete_game_ids,
    )
    failures.extend(athlete_failures)
    source_competitions.update(athlete_competitions)
    historical_club_ids = {
        int(club["id"])
        for wrappers in games_by_athlete.values()
        for wrapper in wrappers
        if (club := foreign_club_for_game(wrapper)) is not None
    }
    historical_competitors, historical_competitions, competitor_failures = collect_competitor_profiles(
        args,
        historical_club_ids,
    )
    failures.extend(competitor_failures)
    competitors.update(historical_competitors)
    source_competitions.update(historical_competitions)
    roster_rows = discover_historical_affiliations(
        current_roster_rows,
        athletes,
        games_by_athlete,
        competitors,
        source_competitions,
    )
    historical_count = len(roster_rows) - len(current_roster_rows)
    print(f"discovered {historical_count} historical foreign club-season affiliations", flush=True)

    rows_by_club: dict[int, list[dict[str, Any]]] = {}
    for row in roster_rows:
        rows_by_club.setdefault(int(row["club_id"]), []).append(row)
    games = athlete_games_in_window(
        games_by_athlete,
        competitors,
        args.start_date,
        args.end_date,
    )
    games_by_id = {int(game["id"]): game for game in games}

    fixture_pages: list[dict[str, Any]] = []
    if not args.athlete_games_only:
        for club_id, club_rows in sorted(rows_by_club.items()):
            competition_ids = {int(row["competition_id"]) for row in club_rows}
            try:
                club_games, page_payload = collect_fixture_feed(
                    args,
                    args.raw_dir / "clubs" / str(club_id),
                    "competitors",
                    club_id,
                )
            except RuntimeError as exc:
                failure = {"club_id": club_id, "kind": "club_fixtures", "error": str(exc)}
                if not args.allow_fetch_failures:
                    raise
                failures.append(failure)
                continue

            league_games = [game for game in club_games if game.get("competitionId") in competition_ids]
            if args.limit:
                league_games = league_games[: args.limit]
            games_by_id.update(
                {int(game["id"]): game for game in league_games if game.get("id") is not None}
            )
            fixture_pages.append(
                {
                    "club_id": club_id,
                    "competition_ids": sorted(competition_ids),
                    "page_count": len(page_payload.get("pages") or []),
                    "selected_game_count": len(league_games),
                    "pages": page_payload.get("pages") or [],
                }
            )

    games = sorted(games_by_id.values(), key=lambda game: game.get("startTime") or "")
    selected_competition_ids = {
        int(game["competitionId"])
        for game in games
        if game.get("competitionId") is not None
    }
    competition_manifests = []
    for competition_id in sorted(selected_competition_ids):
        source_competition = source_competitions.get(competition_id) or {
            "id": competition_id,
            "name": next(
                (
                    row["competition_name"]
                    for row in roster_rows
                    if int(row["competition_id"]) == competition_id
                ),
                f"Competition {competition_id}",
            ),
            "sportId": FOOTBALL_SPORT_ID,
            "competitorsType": 0,
            "hasStats": True,
        }
        competition = {
            **normalize_competition(source_competition),
            "scope": "foreign_club",
            "legionnaire_league": True,
        }
        competition_games = [game for game in games if game.get("competitionId") == competition_id]
        competition_manifests.append(
            {**competition, "seasons": competition_seasons(competition, competition_games, []), "source_history_seasons": []}
        )

    details: dict[int, dict[str, Any]] = {}
    stats: dict[int, dict[str, Any]] = {}
    if not args.fixtures_only:
        loaded_match_ids = known_match_ids_with_player_stats(database_url) if args.missing_details_only else set()
        payload_games = games_requiring_details(games, loaded_match_ids, args.missing_details_only)
        print(f"fetching details for {len(payload_games)} completed foreign-league matches", flush=True)
        details, stats, payload_failures = collect_match_payloads(
            args,
            args.raw_dir,
            payload_games,
            fetch_team_stats=False,
        )
        failures.extend(payload_failures)

    fixture_rows = [base_game_row(game) for game in games]
    all_player_rows, stat_names = flatten_player_match_rows(details)
    player_rows = filter_legionnaire_player_rows(
        all_player_rows,
        {int(row["athlete_id"]) for row in roster_rows},
    )
    legionnaire_ids = {str(row["athlete_id"]) for row in roster_rows}
    shot_rows = [
        row
        for row in flatten_shot_events(details)
        if str(row.get("player_source_id") or "") in legionnaire_ids
    ]
    team_stat_rows = flatten_team_stats(stats)
    write_csv(args.processed_dir / "365scores_fixtures.csv", fixture_rows)
    write_csv(args.processed_dir / "365scores_player_match_stats.csv", player_rows)
    write_csv(args.processed_dir / "365scores_shot_events.csv", shot_rows)
    write_csv(args.processed_dir / "365scores_team_match_stats.csv", team_stat_rows)
    write_csv(args.processed_dir / "365scores_legionnaires.csv", roster_rows)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "competitions": competition_manifests,
        "start_date": args.start_date,
        "end_date": args.end_date,
        "fixture_count": len(fixture_rows),
        "match_detail_count": len(details),
        "player_match_row_count": len(player_rows),
        "shot_event_count": len(shot_rows),
        "team_stat_row_count": len(team_stat_rows),
        "legionnaire_count": len(roster_rows),
        "player_stat_keys": stat_names,
        "fixture_pages": fixture_pages,
        "failures": failures,
        "note": "Current Israeli players abroad are discovered from profiles; historical affiliations are recovered from the complete player game feed, and nightly backfills fetch only missing match details.",
    }
    write_json(args.processed_dir / "365scores_manifest.json", manifest)
    print(
        json.dumps(
            {
                "legionnaires": len(roster_rows),
                "foreign_clubs": len(rows_by_club),
                "foreign_leagues": len(competition_manifests),
                "fixtures": len(fixture_rows),
                "player_match_rows": len(player_rows),
                "failures": len(failures),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0 if args.allow_fetch_failures or not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
