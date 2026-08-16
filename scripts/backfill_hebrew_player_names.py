#!/usr/bin/env python3
"""Populate missing Hebrew player names from the 365Scores athlete feed."""

from __future__ import annotations

import argparse
import json
import os
import socket
import time
from collections.abc import Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import TYPE_CHECKING, Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

if TYPE_CHECKING:
    import psycopg


BASE_URL = "https://webws.365scores.com"
SOURCE_CODE = "365scores"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fill missing core.players.display_name_he values from 365Scores."
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--sleep", type=float, default=0.25)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Refresh existing Hebrew names as well as missing names.",
    )
    parser.add_argument(
        "--allow-fetch-failures",
        action="store_true",
        help="Continue when an athlete batch cannot be fetched after all retries.",
    )
    return parser.parse_args()


def chunked(values: list[str], size: int) -> Iterator[list[str]]:
    if size < 1:
        raise ValueError("batch size must be at least 1")
    for index in range(0, len(values), size):
        yield values[index : index + size]


def is_365scores_athlete_id(value: str) -> bool:
    return value.isdigit() and int(value) > 0


def athletes_url(athlete_ids: Iterable[str]) -> str:
    params = {
        "appTypeId": 5,
        "langId": 2,
        "timezoneName": "Asia/Jerusalem",
        "userCountryId": 6,
        "athletes": ",".join(athlete_ids),
    }
    return f"{BASE_URL}/web/athletes/?{urlencode(params)}"


def game_url(game_id: str) -> str:
    params = {
        "appTypeId": 5,
        "langId": 2,
        "timezoneName": "Asia/Jerusalem",
        "userCountryId": 6,
        "gameId": game_id,
        "topBookmaker": 14,
    }
    return f"{BASE_URL}/web/game/?{urlencode(params)}"


def contains_hebrew(value: str) -> bool:
    return any("\u0590" <= character <= "\u05ff" for character in value)


def extract_hebrew_names(payload: dict[str, Any]) -> dict[str, str]:
    names: dict[str, str] = {}
    athletes = payload.get("athletes")
    if not isinstance(athletes, list):
        return names

    for athlete in athletes:
        if not isinstance(athlete, dict):
            continue
        athlete_id = athlete.get("id")
        name = athlete.get("name")
        if athlete_id is None or not isinstance(name, str):
            continue
        normalized_name = name.strip()
        if normalized_name and contains_hebrew(normalized_name):
            names[str(athlete_id)] = normalized_name
    return names


def extract_game_hebrew_names(payload: dict[str, Any]) -> dict[str, str]:
    names: dict[str, str] = {}
    game = payload.get("game")
    members = game.get("members") if isinstance(game, dict) else None
    if not isinstance(members, list):
        return names

    for member in members:
        if not isinstance(member, dict):
            continue
        name = member.get("name")
        if not isinstance(name, str):
            continue
        normalized_name = name.strip()
        if not normalized_name or not contains_hebrew(normalized_name):
            continue
        for identifier in (member.get("athleteId"), member.get("id")):
            if identifier is not None:
                names[str(identifier)] = normalized_name
    return names


def fetch_json(url: str, *, retries: int, sleep_seconds: float) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, socket.timeout, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(sleep_seconds * (attempt + 1))
    raise RuntimeError(f"failed to fetch Hebrew athlete names: {last_error}")


def player_mappings(cur: psycopg.Cursor, *, refresh: bool) -> dict[str, str]:
    cur.execute(
        """
        select distinct
          mapping.source_entity_id,
          mapping.canonical_id::text as player_id
        from source.source_entity_ids mapping
        join source.sources source on source.id = mapping.source_id
        join core.players player on player.id = mapping.canonical_id
        where source.code = %s
          and mapping.entity_type = 'player'
          and mapping.canonical_id is not null
          and (%s or nullif(btrim(player.display_name_he), '') is null)
        order by mapping.source_entity_id
        """,
        (SOURCE_CODE, refresh),
    )
    return {
        row["source_entity_id"]: row["player_id"]
        for row in cur.fetchall()
        if is_365scores_athlete_id(row["source_entity_id"])
    }


def recent_match_ids(
    cur: psycopg.Cursor,
    source_player_ids: list[str],
) -> dict[str, str]:
    if not source_player_ids:
        return {}
    cur.execute(
        """
        select distinct on (appearance.source_player_id)
          appearance.source_player_id,
          appearance.source_match_id
        from obs.player_appearance_observations appearance
        join source.sources source on source.id = appearance.source_id
        where source.code = %s
          and appearance.source_player_id = any(%s)
        order by
          appearance.source_player_id,
          appearance.observed_at desc,
          appearance.source_match_id desc
        """,
        (SOURCE_CODE, source_player_ids),
    )
    return {row["source_player_id"]: row["source_match_id"] for row in cur.fetchall()}


def game_name_fallback(
    source_player_ids: list[str],
    match_ids_by_source_player: dict[str, str],
    *,
    retries: int,
    sleep_seconds: float,
    workers: int,
    allow_fetch_failures: bool,
) -> tuple[dict[str, str], int]:
    source_players_by_match: dict[str, list[str]] = {}
    for source_player_id in source_player_ids:
        match_id = match_ids_by_source_player.get(source_player_id)
        if match_id:
            source_players_by_match.setdefault(match_id, []).append(source_player_id)

    names: dict[str, str] = {}
    failed_games = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {
            executor.submit(
                fetch_json,
                game_url(match_id),
                retries=retries,
                sleep_seconds=sleep_seconds,
            ): match_id
            for match_id in source_players_by_match
        }
        for future in as_completed(futures):
            match_id = futures[future]
            try:
                game_names = extract_game_hebrew_names(future.result())
            except RuntimeError as exc:
                if not allow_fetch_failures:
                    raise
                failed_games += 1
                print(f"warning: {exc}")
                continue
            for source_player_id in source_players_by_match[match_id]:
                hebrew_name = game_names.get(source_player_id)
                if hebrew_name:
                    names[source_player_id] = hebrew_name
    return names, failed_games


def update_players(
    cur: psycopg.Cursor,
    names_by_player_id: dict[str, str],
    *,
    refresh: bool,
) -> int:
    if not names_by_player_id:
        return 0

    cur.execute(
        """
        create temp table hebrew_player_name_stage (
          player_id uuid primary key,
          display_name_he text not null
        ) on commit drop
        """
    )
    with cur.copy(
        "copy hebrew_player_name_stage (player_id, display_name_he) from stdin"
    ) as copy:
        for player_id, display_name_he in names_by_player_id.items():
            copy.write_row((player_id, display_name_he))

    cur.execute(
        """
        update core.players player
        set display_name_he = stage.display_name_he
        from hebrew_player_name_stage stage
        where player.id = stage.player_id
          and (%s or nullif(btrim(player.display_name_he), '') is null)
        returning player.id
        """,
        (refresh,),
    )
    return len(cur.fetchall())


def main() -> int:
    import psycopg
    from psycopg.rows import dict_row

    args = parse_args()
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be at least 1")
    if args.workers < 1:
        raise SystemExit("--workers must be at least 1")

    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    with psycopg.connect(database_url, row_factory=dict_row, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            mappings = player_mappings(cur, refresh=args.refresh)

            names_by_source_player: dict[str, str] = {}
            failed_batches = 0
            for athlete_batch in chunked(list(mappings), args.batch_size):
                try:
                    payload = fetch_json(
                        athletes_url(athlete_batch),
                        retries=args.retries,
                        sleep_seconds=args.sleep,
                    )
                except RuntimeError as exc:
                    if not args.allow_fetch_failures:
                        raise
                    failed_batches += 1
                    print(f"warning: {exc}")
                    continue

                for source_player_id, hebrew_name in extract_hebrew_names(payload).items():
                    if source_player_id in mappings:
                        names_by_source_player[source_player_id] = hebrew_name
                time.sleep(args.sleep)

            unresolved = [
                source_player_id
                for source_player_id in mappings
                if source_player_id not in names_by_source_player
            ]
            match_ids = recent_match_ids(cur, unresolved)
            game_names, failed_games = game_name_fallback(
                unresolved,
                match_ids,
                retries=args.retries,
                sleep_seconds=args.sleep,
                workers=args.workers,
                allow_fetch_failures=args.allow_fetch_failures,
            )
            names_by_source_player.update(game_names)
            names_by_player_id = {
                mappings[source_player_id]: hebrew_name
                for source_player_id, hebrew_name in names_by_source_player.items()
            }
            updated = update_players(cur, names_by_player_id, refresh=args.refresh)
            conn.commit()

    missing = len(mappings) - len(names_by_source_player)
    print(
        "Hebrew player names: "
        f"eligible={len(mappings)}, returned={len(names_by_source_player)}, "
        f"updated={updated}, missing={missing}, failed_batches={failed_batches}, "
        f"failed_games={failed_games}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
