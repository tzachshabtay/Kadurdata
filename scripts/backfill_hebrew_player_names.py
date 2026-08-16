#!/usr/bin/env python3
"""Populate missing Hebrew player names from the 365Scores athlete feed."""

from __future__ import annotations

import argparse
import json
import os
import socket
import time
from collections.abc import Iterable, Iterator
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

    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    with psycopg.connect(database_url, row_factory=dict_row, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            mappings = player_mappings(cur, refresh=args.refresh)

            names_by_player_id: dict[str, str] = {}
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
                    player_id = mappings.get(source_player_id)
                    if player_id:
                        names_by_player_id[player_id] = hebrew_name
                time.sleep(args.sleep)

            updated = update_players(cur, names_by_player_id, refresh=args.refresh)
            conn.commit()

    missing = len(mappings) - len(names_by_player_id)
    print(
        "Hebrew player names: "
        f"eligible={len(mappings)}, returned={len(names_by_player_id)}, "
        f"updated={updated}, missing={missing}, failed_batches={failed_batches}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
