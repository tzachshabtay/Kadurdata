#!/usr/bin/env python3
"""Fetch SciSports Estimated Transfer Value history exposed on FotMob player pages."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


BASE_URL = "https://www.fotmob.com"
SEARCH_URL = f"{BASE_URL}/api/data/search/suggest"
PROCESSED_DIR = Path("data/processed/fotmob-valuations")
USER_AGENT = "Mozilla/5.0 (compatible; Kadurdata/1.0; football valuation import)"
MARKET_VALUES_MARKER = '"marketValues":'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch FotMob/SciSports player valuations.")
    parser.add_argument("--lookback-years", type=int, default=3)
    parser.add_argument("--include-all-mapped", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Limit players for a smoke run.")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--sleep", type=float, default=0.15)
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    parser.add_argument("--allow-fetch-failures", action="store_true")
    return parser.parse_args()


def fetch_text(url: str, retries: int, sleep_seconds: float) -> str:
    error: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            request = Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/json",
                },
            )
            with urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8")
        except (HTTPError, URLError, TimeoutError) as exc:
            error = exc
            if attempt < retries:
                time.sleep(sleep_seconds * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {error}")


def normalized_name(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    ascii_value = re.sub(r"\b(?:fc|football club)\b", " ", ascii_value.lower())
    return re.sub(r"[^a-z0-9]+", " ", ascii_value).strip()


def slugify(value: str) -> str:
    return normalized_name(value).replace(" ", "-") or "player"


def player_page_url(player_id: str, player_name: str) -> str:
    return f"{BASE_URL}/en-GB/players/{quote(player_id)}/{quote(slugify(player_name))}"


def extract_market_values(html: str) -> list[dict[str, Any]]:
    decoder = json.JSONDecoder()
    candidates: list[dict[str, Any]] = []
    cursor = 0
    while True:
        marker_at = html.find(MARKET_VALUES_MARKER, cursor)
        if marker_at < 0:
            break
        value_at = marker_at + len(MARKET_VALUES_MARKER)
        while value_at < len(html) and html[value_at].isspace():
            value_at += 1
        try:
            market_values, consumed = decoder.raw_decode(html[value_at:])
        except json.JSONDecodeError:
            cursor = value_at + 1
            continue
        cursor = value_at + consumed
        if isinstance(market_values, dict) and isinstance(market_values.get("values"), list):
            candidates.append(market_values)

    if not candidates:
        return []

    best = max(candidates, key=lambda item: len(item.get("values") or []))
    by_date: dict[str, dict[str, Any]] = {}
    for entry in best.get("values") or []:
        date = str(entry.get("date") or "")[:10]
        value = entry.get("value")
        currency = str(entry.get("currency") or "").upper()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) or value is None or len(currency) != 3:
            continue
        by_date[date] = {
            "valuation_date": date,
            "value_amount": int(round(float(value))),
            "currency": currency,
            "lower_bound": integer_or_none(entry.get("lowerBound")),
            "upper_bound": integer_or_none(entry.get("upperBound")),
            "provider": entry.get("source") or "scisports",
            "source_team_id": entry.get("teamId"),
            "source_team_name": entry.get("teamName"),
        }
    return [by_date[date] for date in sorted(by_date)]


def integer_or_none(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    return int(round(float(value)))


def search_suggestions(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        return []
    suggestions: dict[str, dict[str, Any]] = {}
    for group in payload:
        if not isinstance(group, dict):
            continue
        for item in group.get("suggestions") or []:
            if item.get("type") != "player" or item.get("isCoach") or item.get("id") is None:
                continue
            suggestions[str(item["id"])] = item
    return list(suggestions.values())


def select_search_match(
    suggestions: list[dict[str, Any]],
    player_name: str,
    team_name: Optional[str],
) -> Optional[dict[str, Any]]:
    wanted_name = normalized_name(player_name)
    exact_name = [item for item in suggestions if normalized_name(str(item.get("name") or "")) == wanted_name]
    if not exact_name:
        return None

    wanted_team = normalized_name(team_name or "")
    if wanted_team:
        exact_team = [
            item for item in exact_name
            if normalized_name(str(item.get("teamName") or "")) == wanted_team
        ]
        if len(exact_team) == 1:
            return exact_team[0]
    return exact_name[0] if len(exact_name) == 1 else None


def resolve_fotmob_player(
    player_name: str,
    team_name: Optional[str],
    retries: int,
    sleep_seconds: float,
) -> Optional[dict[str, Any]]:
    payload = json.loads(
        fetch_text(
            f"{SEARCH_URL}?term={quote(player_name)}",
            retries,
            sleep_seconds,
        )
    )
    return select_search_match(search_suggestions(payload), player_name, team_name)


def candidate_players(
    database_url: str,
    lookback_years: int,
    include_all_mapped: bool,
) -> list[dict[str, Any]]:
    import psycopg
    from psycopg.rows import dict_row

    query = """
      with recent_players as (
        select distinct appearance.player_id
        from core.player_match_appearances appearance
        join core.matches match on match.id = appearance.match_id
        where match.scheduled_at >= current_date - make_interval(years => %s)
      ), latest_team as (
        select distinct on (appearance.player_id)
          appearance.player_id,
          team.name as team_name
        from core.player_match_appearances appearance
        join core.matches match on match.id = appearance.match_id
        join core.teams team on team.id = appearance.team_id
        order by appearance.player_id, match.scheduled_at desc nulls last
      ), fotmob_source as (
        select id from source.sources where code = 'fotmob'
      )
      select
        player.id::text as canonical_player_id,
        player.display_name,
        player.display_name_he,
        latest_team.team_name,
        mapping.source_entity_id as fotmob_player_id
      from core.players player
      left join recent_players on recent_players.player_id = player.id
      left join latest_team on latest_team.player_id = player.id
      left join lateral (
        select source_entity_id
        from source.source_entity_ids
        where source_id = (select id from fotmob_source)
          and entity_type = 'player'
          and canonical_id = player.id
        order by last_seen_at desc, source_entity_id
        limit 1
      ) mapping on true
      where recent_players.player_id is not null
         or (%s and mapping.source_entity_id is not null)
      order by player.display_name, player.id
    """
    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        return list(connection.execute(query, (max(lookback_years, 0), include_all_mapped)).fetchall())


def fetch_player_valuations(
    player: dict[str, Any],
    retries: int,
    sleep_seconds: float,
) -> tuple[list[dict[str, Any]], Optional[dict[str, Any]]]:
    player_id = str(player.get("fotmob_player_id") or "")
    try:
        if not player_id:
            suggestion = resolve_fotmob_player(
                str(player["display_name"]),
                player.get("team_name"),
                retries,
                sleep_seconds,
            )
            if not suggestion:
                return [], {
                    "canonical_player_id": player["canonical_player_id"],
                    "player_name": player["display_name"],
                    "kind": "unresolved_player",
                }
            player_id = str(suggestion["id"])

        source_url = player_page_url(player_id, str(player["display_name"]))
        values = extract_market_values(fetch_text(source_url, retries, sleep_seconds))
        if not values:
            return [], {
                "canonical_player_id": player["canonical_player_id"],
                "source_player_id": player_id,
                "player_name": player["display_name"],
                "kind": "no_valuation_history",
            }
        rows = [
            {
                "canonical_player_id": player["canonical_player_id"],
                "source_player_id": player_id,
                "player_name": player["display_name"],
                "source_url": source_url,
                **value,
            }
            for value in values
        ]
        return rows, None
    except Exception as exc:  # noqa: BLE001 - failures are recorded per player
        return [], {
            "canonical_player_id": player["canonical_player_id"],
            "source_player_id": player_id or None,
            "player_name": player["display_name"],
            "kind": "fetch_error",
            "error": str(exc),
        }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = sorted({field for row in rows for field in row})
    with path.open("w", encoding="utf-8", newline="") as handle:
        if not fields:
            return
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    args = parse_args()
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    players = candidate_players(database_url, args.lookback_years, args.include_all_mapped)
    if args.limit:
        players = players[: args.limit]

    rows: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(args.workers, 1)) as executor:
        futures = {
            executor.submit(fetch_player_valuations, player, args.retries, args.sleep): player
            for player in players
        }
        for index, future in enumerate(as_completed(futures), start=1):
            player_rows, failure = future.result()
            rows.extend(player_rows)
            if failure:
                failures.append(failure)
            if index % 50 == 0 or index == len(players):
                print(f"processed {index}/{len(players)} players", flush=True)

    args.processed_dir.mkdir(parents=True, exist_ok=True)
    write_csv(args.processed_dir / "player_valuations.csv", rows)
    manifest = {
        "source": {
            "code": "scisports_etv_fotmob",
            "name": "SciSports ETV via FotMob",
            "kind": "derived_market_valuation",
            "base_url": BASE_URL,
        },
        "candidate_count": len(players),
        "matched_player_count": len({row["canonical_player_id"] for row in rows}),
        "valuation_count": len(rows),
        "failure_count": len(failures),
        "failures": failures,
    }
    (args.processed_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({key: manifest[key] for key in (
        "candidate_count",
        "matched_player_count",
        "valuation_count",
        "failure_count",
    )}, indent=2))
    if failures and not args.allow_fetch_failures:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
