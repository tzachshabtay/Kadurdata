#!/usr/bin/env python3
"""Populate Hebrew player names from 365Scores and Transfermarkt source identities."""

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

try:
    from scripts.sync_fotmob_loans import normalized_name, upsert_mapping
    from scripts.sync_transfermarkt_loans import (
        api_url as transfermarkt_api_url,
        fetch_entities as fetch_transfermarkt_entities,
        fetch_json as fetch_transfermarkt_json,
        get_source as get_transfermarkt_source,
        hebrew_name as transfermarkt_hebrew_name,
    )
except ModuleNotFoundError:
    from sync_fotmob_loans import normalized_name, upsert_mapping
    from sync_transfermarkt_loans import (
        api_url as transfermarkt_api_url,
        fetch_entities as fetch_transfermarkt_entities,
        fetch_json as fetch_transfermarkt_json,
        get_source as get_transfermarkt_source,
        hebrew_name as transfermarkt_hebrew_name,
    )

if TYPE_CHECKING:
    import psycopg


BASE_URL = "https://webws.365scores.com"
SOURCE_CODE = "365scores"
TRANSFERMARKT_COUNTRY_ID = 74
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


def search_url(player_name: str) -> str:
    params = {
        "appTypeId": 5,
        "langId": 1,
        "timezoneName": "Asia/Jerusalem",
        "userCountryId": 6,
        "query": player_name,
    }
    return f"{BASE_URL}/web/search/?{urlencode(params)}"


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


def players_needing_hebrew(cur: psycopg.Cursor, *, refresh: bool) -> list[dict[str, str]]:
    cur.execute(
        """
        select player.id::text as player_id, player.display_name
        from core.players player
        where %s or nullif(btrim(player.display_name_he), '') is null
        order by player.display_name, player.id
        """,
        (refresh,),
    )
    return [dict(row) for row in cur.fetchall()]


def all_365scores_player_mappings(cur: psycopg.Cursor) -> dict[str, str]:
    cur.execute(
        """
        select mapping.source_entity_id, mapping.canonical_id::text as player_id
        from source.source_entity_ids mapping
        join source.sources source on source.id = mapping.source_id
        where source.code = %s
          and mapping.entity_type = 'player'
          and mapping.canonical_id is not null
        """,
        (SOURCE_CODE,),
    )
    return {str(row["source_entity_id"]): str(row["player_id"]) for row in cur.fetchall()}


def quick_search_365scores_players(
    players: list[dict[str, str]],
    *,
    retries: int,
    sleep_seconds: float,
    workers: int,
    allow_fetch_failures: bool,
) -> tuple[dict[str, dict[str, str]], int]:
    resolved: dict[str, dict[str, str]] = {}
    failures = 0

    def search(player: dict[str, str]) -> tuple[str, Optional[dict[str, str]]]:
        payload = fetch_json(
            search_url(player["display_name"]),
            retries=retries,
            sleep_seconds=sleep_seconds,
        )
        wanted = normalized_name(player["display_name"])
        matches = [
            athlete
            for athlete in payload.get("athletes") or []
            if isinstance(athlete, dict)
            and int(athlete.get("sportId") or 0) == 1
            and athlete.get("id") is not None
            and normalized_name(str(athlete.get("name") or "")) == wanted
        ]
        if len(matches) != 1:
            return player["player_id"], None
        return player["player_id"], {
            "source_player_id": str(matches[0]["id"]),
            "source_name": str(matches[0].get("name") or player["display_name"]),
        }

    with ThreadPoolExecutor(max_workers=max(workers, 1)) as executor:
        pending = {executor.submit(search, player): player for player in players}
        for future in as_completed(pending):
            player = pending[future]
            try:
                player_id, match = future.result()
            except RuntimeError as exc:
                if not allow_fetch_failures:
                    raise
                failures += 1
                print(f"warning: 365Scores search failed for {player['display_name']}: {exc}")
                continue
            if match:
                resolved[player_id] = match
    return resolved, failures


def transfermarkt_mappings(cur: psycopg.Cursor, player_ids: list[str]) -> dict[str, str]:
    if not player_ids:
        return {}
    cur.execute(
        """
        select mapping.source_entity_id, mapping.canonical_id::text as player_id
        from source.source_entity_ids mapping
        join source.sources source on source.id = mapping.source_id
        where source.code = 'transfermarkt'
          and mapping.entity_type = 'player'
          and mapping.canonical_id = any(%s::uuid[])
        """,
        (player_ids,),
    )
    return {str(row["source_entity_id"]): str(row["player_id"]) for row in cur.fetchall()}


def quick_search_transfermarkt_player_ids(
    players: list[dict[str, str]],
    *,
    retries: int,
    sleep_seconds: float,
    workers: int,
    allow_fetch_failures: bool,
) -> tuple[dict[str, list[str]], int]:
    results: dict[str, list[str]] = {}
    failures = 0

    def search(player: dict[str, str]) -> tuple[str, list[str]]:
        payload = fetch_transfermarkt_json(
            transfermarkt_api_url("quick-search", [("term", player["display_name"])]),
            retries,
            sleep_seconds,
        )
        data = payload.get("data")
        result = data.get("result") if isinstance(data, dict) else None
        ids = result.get("playerIds") if isinstance(result, dict) else None
        return player["player_id"], [str(value) for value in ids or []]

    with ThreadPoolExecutor(max_workers=max(workers, 1)) as executor:
        pending = {executor.submit(search, player): player for player in players}
        for future in as_completed(pending):
            player = pending[future]
            try:
                player_id, candidate_ids = future.result()
            except RuntimeError as exc:
                if not allow_fetch_failures:
                    raise
                failures += 1
                print(f"warning: Transfermarkt search failed for {player['display_name']}: {exc}")
                continue
            results[player_id] = candidate_ids
    return results, failures


def is_israeli_transfermarkt_player(player: dict[str, Any]) -> bool:
    nationality = player.get("nationalityDetails")
    nationalities = nationality.get("nationalities") if isinstance(nationality, dict) else None
    if not isinstance(nationalities, dict):
        return False
    return TRANSFERMARKT_COUNTRY_ID in {
        int(nationalities.get("nationalityId") or 0),
        int(nationalities.get("secondNationalityId") or 0),
    }


def select_transfermarkt_player(
    canonical_name: str,
    candidate_ids: list[str],
    entities: dict[str, dict[str, Any]],
) -> Optional[dict[str, Any]]:
    wanted = normalized_name(canonical_name)
    matches = [
        entities[candidate_id]
        for candidate_id in candidate_ids
        if candidate_id in entities
        and is_israeli_transfermarkt_player(entities[candidate_id])
        and normalized_name(str(entities[candidate_id].get("name") or "")) == wanted
    ]
    return matches[0] if len(matches) == 1 else None


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

            all_candidates = players_needing_hebrew(cur, refresh=args.refresh)
            unresolved_players = [
                player
                for player in all_candidates
                if player["player_id"] not in names_by_player_id
            ]
            all_365_mappings = all_365scores_player_mappings(cur)
            searched_365, search_365_failures = quick_search_365scores_players(
                unresolved_players,
                retries=args.retries,
                sleep_seconds=args.sleep,
                workers=args.workers,
                allow_fetch_failures=args.allow_fetch_failures,
            )
            searched_source_ids = list({
                match["source_player_id"]
                for match in searched_365.values()
            })
            searched_hebrew_names: dict[str, str] = {}
            for athlete_batch in chunked(searched_source_ids, args.batch_size):
                try:
                    searched_payload = fetch_json(
                        athletes_url(athlete_batch),
                        retries=args.retries,
                        sleep_seconds=args.sleep,
                    )
                except RuntimeError as exc:
                    if not args.allow_fetch_failures:
                        raise
                    search_365_failures += 1
                    print(f"warning: {exc}")
                    continue
                searched_hebrew_names.update(extract_hebrew_names(searched_payload))
            scores365_source_id = str(
                cur.execute(
                    "select id::text from source.sources where code = %s limit 1",
                    (SOURCE_CODE,),
                ).fetchone()["id"]
            )
            searched_365_matches = 0
            for player in unresolved_players:
                match = searched_365.get(player["player_id"])
                if not match:
                    continue
                source_player_id = match["source_player_id"]
                mapped_player_id = all_365_mappings.get(source_player_id)
                if mapped_player_id and mapped_player_id != player["player_id"]:
                    continue
                name = searched_hebrew_names.get(source_player_id)
                if not name:
                    continue
                names_by_player_id[player["player_id"]] = name
                upsert_mapping(
                    cur,
                    scores365_source_id,
                    "player",
                    source_player_id,
                    "core.players",
                    player["player_id"],
                    match["source_name"],
                )
                all_365_mappings[source_player_id] = player["player_id"]
                searched_365_matches += 1

            unresolved_players = [
                player
                for player in unresolved_players
                if player["player_id"] not in names_by_player_id
            ]
            unresolved_by_id = {player["player_id"]: player for player in unresolved_players}
            mapped_transfermarkt = transfermarkt_mappings(cur, list(unresolved_by_id))
            transfermarkt_entities: dict[str, dict[str, Any]] = {}
            transfermarkt_failures = 0
            if mapped_transfermarkt:
                try:
                    transfermarkt_entities.update(
                        fetch_transfermarkt_entities(
                            "players",
                            mapped_transfermarkt,
                            args.retries,
                            args.sleep,
                            args.workers,
                        )
                    )
                except RuntimeError as exc:
                    if not args.allow_fetch_failures:
                        raise
                    transfermarkt_failures += 1
                    print(f"warning: {exc}")
            for source_player_id, player_id in mapped_transfermarkt.items():
                name = transfermarkt_hebrew_name(transfermarkt_entities.get(source_player_id) or {})
                if name:
                    names_by_player_id[player_id] = name

            search_players = [
                player
                for player in unresolved_players
                if player["player_id"] not in names_by_player_id
                and player["player_id"] not in set(mapped_transfermarkt.values())
            ]
            quick_search_results, quick_search_failures = quick_search_transfermarkt_player_ids(
                search_players,
                retries=args.retries,
                sleep_seconds=args.sleep,
                workers=args.workers,
                allow_fetch_failures=args.allow_fetch_failures,
            )
            candidate_transfermarkt_ids = {
                candidate_id
                for candidate_ids in quick_search_results.values()
                for candidate_id in candidate_ids
            }
            if candidate_transfermarkt_ids:
                try:
                    transfermarkt_entities.update(
                        fetch_transfermarkt_entities(
                            "players",
                            candidate_transfermarkt_ids,
                            args.retries,
                            args.sleep,
                            args.workers,
                        )
                    )
                except RuntimeError as exc:
                    if not args.allow_fetch_failures:
                        raise
                    transfermarkt_failures += 1
                    print(f"warning: {exc}")

            transfermarkt_source_id = get_transfermarkt_source(cur)
            transfermarkt_search_matches = 0
            for player in search_players:
                selected = select_transfermarkt_player(
                    player["display_name"],
                    quick_search_results.get(player["player_id"], []),
                    transfermarkt_entities,
                )
                name = transfermarkt_hebrew_name(selected or {})
                if not selected or not name:
                    continue
                source_player_id = str(selected["id"])
                names_by_player_id[player["player_id"]] = name
                upsert_mapping(
                    cur,
                    transfermarkt_source_id,
                    "player",
                    source_player_id,
                    "core.players",
                    player["player_id"],
                    str(selected.get("name") or player["display_name"]),
                )
                transfermarkt_search_matches += 1

            updated = update_players(cur, names_by_player_id, refresh=args.refresh)
            cur.execute(
                """
                select player.display_name
                from core.players player
                where nullif(btrim(player.display_name_he), '') is null
                order by player.display_name, player.id
                """
            )
            still_missing_names = [str(row["display_name"]) for row in cur.fetchall()]
            conn.commit()

    missing_365 = len(mappings) - len(names_by_source_player)
    print(
        "Hebrew player names: "
        f"database_candidates={len(all_candidates)}, 365scores_eligible={len(mappings)}, "
        f"365scores_returned={len(names_by_source_player)}, 365scores_missing={missing_365}, "
        f"365scores_search_matches={searched_365_matches}, "
        f"transfermarkt_mapped={len(mapped_transfermarkt)}, "
        f"transfermarkt_search_matches={transfermarkt_search_matches}, updated={updated}, "
        f"database_missing={len(still_missing_names)}, failed_batches={failed_batches}, "
        f"failed_games={failed_games}, 365scores_search_failures={search_365_failures}, "
        f"transfermarkt_failures={transfermarkt_failures + quick_search_failures}"
    )
    if still_missing_names:
        print("Unresolved Hebrew player names: " + ", ".join(still_missing_names[:80]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
