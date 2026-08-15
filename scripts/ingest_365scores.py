#!/usr/bin/env python3
"""Fetch and flatten Israeli competition data from 365Scores.

The source exposes a live Israeli competition catalog. This command can ingest
one competition or discover every Israeli football competition, then fetch
fixtures, match details, team stats, and per-player lineup stats.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import socket
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen


BASE_URL = "https://webws.365scores.com"
COMPETITOR_IMAGE_BASE_URL = (
    "https://imagecache.365scores.com/image/upload/"
    "f_png,w_128,h_128,c_limit,q_auto:eco,dpr_2,d_Competitors:default1.png"
)
DEFAULT_COMPETITION_ID = 42
DEFAULT_LANG_ID = 1
DEFAULT_TIMEZONE = "Asia/Jerusalem"
DEFAULT_USER_COUNTRY_ID = 6
DEFAULT_APP_TYPE_ID = 5
ISRAEL_COUNTRY_ID = 6
FOOTBALL_SPORT_ID = 1
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)


def default_date_window() -> Tuple[str, str]:
    now = datetime.now()
    if now.month >= 7:
        return f"{now.year - 1}-07-01", f"{now.year + 1}-06-30"
    return f"{now.year - 1}-07-01", f"{now.year}-06-30"


DEFAULT_START_DATE, DEFAULT_END_DATE = default_date_window()


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_")


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def build_url(path: str, params: Dict[str, Any]) -> str:
    return f"{BASE_URL}{path}?{urlencode(params)}"


def game_date(game: Dict[str, Any]) -> str:
    start_time = game.get("startTime") or ""
    return start_time[:10]


def game_is_in_window(game: Dict[str, Any], start_date: str, end_date: str) -> bool:
    date = game_date(game)
    return bool(date) and start_date <= date <= end_date


def fetch_json(url: str, *, retries: int, sleep_seconds: float) -> Dict[str, Any]:
    last_error: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8")
            return json.loads(body)
        except (HTTPError, URLError, TimeoutError, socket.timeout, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(sleep_seconds * (attempt + 1))
    raise RuntimeError(f"failed to fetch JSON from {url}: {last_error}")


def cached_fetch(
    url: str,
    cache_path: Path,
    *,
    retries: int,
    sleep_seconds: float,
    refresh: bool,
) -> Dict[str, Any]:
    if cache_path.exists() and not refresh:
        return read_json(cache_path)
    payload = fetch_json(url, retries=retries, sleep_seconds=sleep_seconds)
    write_json(cache_path, payload)
    time.sleep(sleep_seconds)
    return payload


def competition_type(name: str) -> str:
    normalized = name.lower()
    if "super cup" in normalized:
        return "super_cup"
    if "cup" in normalized:
        return "cup"
    return "league"


def normalize_competition(source_competition: Dict[str, Any]) -> Dict[str, Any]:
    source_name = source_competition.get("name") or f"Competition {source_competition.get('id')}"
    display_name = (
        source_competition.get("longName")
        or source_competition.get("shortName")
        or source_name
    )
    is_youth = "youth" in source_name.lower()
    return {
        "id": source_competition.get("id"),
        "name": display_name,
        "source_name": source_name,
        "short_name": source_competition.get("shortName"),
        "long_name": source_competition.get("longName"),
        "competition_type": competition_type(source_name),
        "gender": "women" if "women" in source_name.lower() else "men",
        "age_group": "youth" if is_youth else "senior",
        "current_season_num": source_competition.get("currentSeasonNum"),
        "has_stats": bool(source_competition.get("hasStats")),
        "has_history": bool(source_competition.get("hasHistory")),
        "has_standings": bool(source_competition.get("hasStandings")),
        "has_brackets": bool(source_competition.get("hasBrackets")),
    }


def collect_competition_catalog(args: argparse.Namespace, raw_dir: Path) -> List[Dict[str, Any]]:
    payload = cached_fetch(
        build_url(
            "/web/competitions/",
            {
                "appTypeId": args.app_type_id,
                "langId": args.lang_id,
                "timezoneName": args.timezone,
                "userCountryId": args.user_country_id,
                "countries": ISRAEL_COUNTRY_ID,
                "sports": FOOTBALL_SPORT_ID,
            },
        ),
        raw_dir / "competitions.json",
        retries=args.retries,
        sleep_seconds=args.sleep,
        refresh=args.refresh,
    )
    competitions = [normalize_competition(item) for item in payload.get("competitions") or []]
    return sorted((item for item in competitions if item.get("id") is not None), key=lambda item: item["id"])


def collect_competition_history(
    args: argparse.Namespace,
    raw_dir: Path,
    competition_id: int,
) -> List[Dict[str, Any]]:
    payload = cached_fetch(
        build_url(
            "/web/competitions/history/",
            {
                "appTypeId": args.app_type_id,
                "langId": args.lang_id,
                "timezoneName": args.timezone,
                "userCountryId": args.user_country_id,
                "competitions": competition_id,
            },
        ),
        raw_dir / "history.json",
        retries=min(args.retries, 1),
        sleep_seconds=args.sleep,
        refresh=args.refresh,
    )
    rows = (payload.get("table") or {}).get("rows") or []
    return [
        {
            "num": row.get("seasonNum"),
            "name": row.get("title"),
            "has_table": bool(row.get("hasTable")),
            "has_group": bool(row.get("hasGroup")),
        }
        for row in rows
        if row.get("seasonNum") is not None and row.get("title")
    ]


def inferred_season_name(games: Iterable[Dict[str, Any]]) -> str:
    labels: Counter[str] = Counter()
    for game in games:
        date = game_date(game)
        if len(date) < 7:
            continue
        year = int(date[:4])
        month = int(date[5:7])
        start_year = year if month >= 7 else year - 1
        labels[f"{start_year}/{start_year + 1}"] += 1
    return labels.most_common(1)[0][0] if labels else "unknown"


def competition_seasons(
    competition: Dict[str, Any],
    games: Iterable[Dict[str, Any]],
    history: Iterable[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    history_by_num = {str(row["num"]): row for row in history}
    games_by_season: Dict[str, List[Dict[str, Any]]] = {}
    for game in games:
        season_num = game.get("seasonNum")
        if season_num is None:
            continue
        games_by_season.setdefault(str(season_num), []).append(game)

    seasons = []
    for season_num, season_games in games_by_season.items():
        history_row = history_by_num.get(season_num) or {}
        dates = sorted(game_date(game) for game in season_games if game_date(game))
        seasons.append(
            {
                "num": int(season_num),
                "name": history_row.get("name") or inferred_season_name(season_games),
                "start_date": dates[0] if dates else None,
                "end_date": dates[-1] if dates else None,
                "match_count": len(season_games),
                "is_current": int(season_num) == competition.get("current_season_num"),
            }
        )
    return sorted(seasons, key=lambda season: (season["start_date"] or "", season["num"]))


def parse_stat_value(value: Any) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """Parse values such as "29/34 (85%)", "0/1", "90'", "51%", or "2"."""
    if value is None:
        return None, None, None
    text = str(value).strip()
    made_attempted = re.fullmatch(r"(-?\d+(?:\.\d+)?)/(-?\d+(?:\.\d+)?)(?:\s+\((\d+(?:\.\d+)?)%\))?", text)
    if made_attempted:
        made = float(made_attempted.group(1))
        attempted = float(made_attempted.group(2))
        percentage = float(made_attempted.group(3)) if made_attempted.group(3) is not None else None
        return made, attempted, percentage

    percentage_only = re.fullmatch(r"(-?\d+(?:\.\d+)?)%", text)
    if percentage_only:
        return None, None, float(percentage_only.group(1))

    minutes = re.fullmatch(r"(\d+)'", text)
    if minutes:
        return float(minutes.group(1)), None, None

    numeric = re.fullmatch(r"-?\d+(?:\.\d+)?", text)
    if numeric:
        return float(text), None, None

    return None, None, None


def fixture_params(args: argparse.Namespace) -> Dict[str, Any]:
    return {
        "appTypeId": args.app_type_id,
        "langId": args.lang_id,
        "timezoneName": args.timezone,
        "userCountryId": args.user_country_id,
        "competitions": args.competition_id,
        "startDate": args.start_date,
        "endDate": args.end_date,
    }


def page_params(args: argparse.Namespace, page_url: str) -> Optional[Dict[str, Any]]:
    parsed = urlparse(page_url)
    query = parse_qs(parsed.query)
    aftergame = query.get("aftergame", [None])[0]
    direction = query.get("direction", [None])[0]
    if not aftergame or not direction:
        return None
    return {
        "appTypeId": args.app_type_id,
        "langId": args.lang_id,
        "timezoneName": args.timezone,
        "userCountryId": args.user_country_id,
        "competitions": args.competition_id,
        "games": 1,
        "aftergame": aftergame,
        "direction": direction,
    }


def fixture_page_cache_path(raw_dir: Path, params: Dict[str, Any]) -> Path:
    direction = params.get("direction", "initial")
    aftergame = params.get("aftergame", "initial")
    return raw_dir / "fixture_pages" / f"{direction}_{aftergame}.json"


def collect_fixtures(args: argparse.Namespace, raw_dir: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    url = build_url("/web/games/results/", fixture_params(args))
    payload = cached_fetch(
        url,
        raw_dir / "fixtures.json",
        retries=args.retries,
        sleep_seconds=args.sleep,
        refresh=args.refresh,
    )
    initial_games = payload.get("games") or []
    games_by_id = {
        game.get("id"): game
        for game in initial_games
        if game.get("id") is not None and game_is_in_window(game, args.start_date, args.end_date)
    }
    pages = [
        {
            "kind": "initial",
            "game_count": len(initial_games),
            "in_window_game_count": len(games_by_id),
            "paging": payload.get("paging"),
        }
    ]

    if not args.walk_pages:
        return list(games_by_id.values()), {"initial": payload, "pages": pages}

    pending: List[str] = []
    for key in ("previousPage", "nextPage"):
        page_url = (payload.get("paging") or {}).get(key)
        if page_url:
            pending.append(page_url)

    seen_page_keys = set()
    while pending and len(pages) < args.max_fixture_pages:
        page_url = pending.pop(0)
        params = page_params(args, page_url)
        if not params:
            continue

        page_key = f"{params['direction']}:{params['aftergame']}"
        if page_key in seen_page_keys:
            continue
        seen_page_keys.add(page_key)

        page_payload = cached_fetch(
            build_url("/web/games/", params),
            fixture_page_cache_path(raw_dir, params),
            retries=args.retries,
            sleep_seconds=args.sleep,
            refresh=args.refresh,
        )
        page_games = page_payload.get("games") or []
        in_window_games = [game for game in page_games if game_is_in_window(game, args.start_date, args.end_date)]
        for game in in_window_games:
            games_by_id[game.get("id")] = game

        date_values = [game_date(game) for game in page_games if game_date(game)]
        min_date = min(date_values) if date_values else None
        max_date = max(date_values) if date_values else None
        direction = str(params["direction"])
        pages.append(
            {
                "kind": "page",
                "direction": direction,
                "aftergame": params["aftergame"],
                "game_count": len(page_games),
                "in_window_game_count": len(in_window_games),
                "min_date": min_date,
                "max_date": max_date,
                "paging": page_payload.get("paging"),
            }
        )

        if direction == "-1" and min_date and min_date < args.start_date:
            continue
        if direction == "1" and max_date and max_date > args.end_date:
            continue

        for key in ("previousPage", "nextPage"):
            next_page_url = (page_payload.get("paging") or {}).get(key)
            if next_page_url:
                pending.append(next_page_url)

    return list(games_by_id.values()), {"initial": payload, "pages": pages}


def collect_game_payload(
    args: argparse.Namespace,
    raw_dir: Path,
    game: Dict[str, Any],
    fetch_team_stats: bool,
) -> Tuple[int, Optional[Dict[str, Any]], Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    failures: List[Dict[str, Any]] = []
    game_id = game.get("id")
    if game_id is None:
        return 0, None, None, failures

    detail_url = build_url(
        "/web/game/",
        {
            "appTypeId": args.app_type_id,
            "langId": args.lang_id,
            "timezoneName": args.timezone,
            "userCountryId": args.user_country_id,
            "gameId": game_id,
            "topBookmaker": 14,
        },
    )
    detail_payload = None
    stats_payload = None
    try:
        detail_payload = cached_fetch(
            detail_url,
            raw_dir / "matches" / f"{game_id}.json",
            retries=args.retries,
            sleep_seconds=args.sleep,
            refresh=args.refresh,
        )
    except RuntimeError as exc:
        failures.append({"game_id": game_id, "kind": "details", "error": str(exc)})

    if fetch_team_stats:
        stats_url = build_url(
            "/web/game/stats/",
            {
                "appTypeId": args.app_type_id,
                "langId": args.lang_id,
                "timezoneName": args.timezone,
                "userCountryId": args.user_country_id,
                "games": game_id,
            },
        )
        try:
            stats_payload = cached_fetch(
                stats_url,
                raw_dir / "match_stats" / f"{game_id}.json",
                retries=args.retries,
                sleep_seconds=args.sleep,
                refresh=args.refresh,
            )
        except RuntimeError as exc:
            failures.append({"game_id": game_id, "kind": "stats", "error": str(exc)})

    return int(game_id), detail_payload, stats_payload, failures


def collect_match_payloads(
    args: argparse.Namespace,
    raw_dir: Path,
    games: Iterable[Dict[str, Any]],
    *,
    fetch_team_stats: bool = True,
) -> Tuple[Dict[int, Dict[str, Any]], Dict[int, Dict[str, Any]], List[Dict[str, Any]]]:
    details: Dict[int, Dict[str, Any]] = {}
    stats: Dict[int, Dict[str, Any]] = {}
    failures: List[Dict[str, Any]] = []
    game_list = list(games)

    workers = max(1, getattr(args, "workers", 1))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(collect_game_payload, args, raw_dir, game, fetch_team_stats): game
            for game in game_list
        }
        for future in as_completed(futures):
            game_id, detail_payload, stats_payload, game_failures = future.result()
            if detail_payload is not None:
                details[game_id] = detail_payload
            if stats_payload is not None:
                stats[game_id] = stats_payload
            failures.extend(game_failures)

    return details, stats, failures


def team_name(team: Dict[str, Any]) -> Optional[str]:
    return team.get("longName") or team.get("name")


def team_logo_url(team: Dict[str, Any]) -> Optional[str]:
    team_id = team.get("id")
    image_version = team.get("imageVersion")
    if team_id is None or image_version is None:
        return None
    return f"{COMPETITOR_IMAGE_BASE_URL}/v{image_version}/Competitors/{team_id}"


def base_game_row(game: Dict[str, Any]) -> Dict[str, Any]:
    home = game.get("homeCompetitor") or {}
    away = game.get("awayCompetitor") or {}
    return {
        "game_id": game.get("id"),
        "competition_id": game.get("competitionId"),
        "season_num": game.get("seasonNum"),
        "stage_num": game.get("stageNum"),
        "round_num": game.get("roundNum"),
        "round_name": game.get("roundName"),
        "start_time": game.get("startTime"),
        "status_id": game.get("statusId"),
        "status_text": game.get("statusText"),
        "home_team_id": home.get("id"),
        "home_team": team_name(home),
        "home_team_logo_url": team_logo_url(home),
        "home_team_image_version": home.get("imageVersion"),
        "home_team_color": home.get("color"),
        "home_team_away_color": home.get("awayColor"),
        "home_score": home.get("score"),
        "away_team_id": away.get("id"),
        "away_team": team_name(away),
        "away_team_logo_url": team_logo_url(away),
        "away_team_image_version": away.get("imageVersion"),
        "away_team_color": away.get("color"),
        "away_team_away_color": away.get("awayColor"),
        "away_score": away.get("score"),
    }


def flatten_fixtures(games: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [base_game_row(game) for game in games]


def member_by_lineup_id(match: Dict[str, Any]) -> Dict[int, Dict[str, Any]]:
    out: Dict[int, Dict[str, Any]] = {}
    for member in match.get("members") or []:
        member_id = member.get("id")
        if member_id is not None:
            out[int(member_id)] = member
    return out


def flatten_player_match_rows(details: Dict[int, Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    rows: List[Dict[str, Any]] = []
    stat_names = set()

    for game_id, payload in details.items():
        match = payload.get("game") or {}
        game_base = base_game_row(match)
        member_lookup = member_by_lineup_id(match)

        for side in ("home", "away"):
            team = match.get(f"{side}Competitor") or {}
            lineup = ((team.get("lineups") or {}).get("members")) or []
            opponent = match.get("awayCompetitor" if side == "home" else "homeCompetitor") or {}

            for lineup_member in lineup:
                lineup_id = lineup_member.get("id")
                member = member_lookup.get(int(lineup_id), {}) if lineup_id is not None else {}
                base = {
                    **game_base,
                    "team_side": side,
                    "team_id": team.get("id"),
                    "team": team_name(team),
                    "opponent_id": opponent.get("id"),
                    "opponent": team_name(opponent),
                    "lineup_member_id": lineup_id,
                    "athlete_id": member.get("athleteId"),
                    "player_name": member.get("name"),
                    "player_short_name": member.get("shortName"),
                    "jersey_number": member.get("jerseyNumber"),
                    "country_id": member.get("countryId") or lineup_member.get("nationalId"),
                    "position_id": (lineup_member.get("position") or {}).get("id"),
                    "position_name": (lineup_member.get("position") or {}).get("name"),
                    "formation_id": (lineup_member.get("formation") or {}).get("id"),
                    "formation_name": (lineup_member.get("formation") or {}).get("name"),
                    "lineup_status": lineup_member.get("status"),
                    "lineup_status_text": lineup_member.get("statusText"),
                    "rating": lineup_member.get("ranking"),
                    "has_stats": lineup_member.get("hasStats"),
                    "heatmap_url": lineup_member.get("heatMap"),
                }

                for stat in lineup_member.get("stats") or []:
                    stat_name = stat.get("name")
                    if not stat_name:
                        continue
                    key = slugify(stat_name)
                    raw_value = stat.get("value")
                    value, attempted, percentage = parse_stat_value(raw_value)
                    stat_names.add(key)
                    base[f"stat_{key}_raw"] = raw_value
                    if value is not None:
                        base[f"stat_{key}_value"] = value
                    if attempted is not None:
                        base[f"stat_{key}_attempted"] = attempted
                    if percentage is not None:
                        base[f"stat_{key}_percentage"] = percentage

                rows.append(base)

    return rows, sorted(stat_names)


def flatten_team_stats(stats_payloads: Dict[int, Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for game_id, payload in stats_payloads.items():
        competitors = {item.get("id"): item for item in payload.get("competitors") or []}
        games = payload.get("games") or []
        game = games[0] if games else {"id": game_id}
        game_base = base_game_row(game)

        for stat in payload.get("statistics") or []:
            competitor_id = stat.get("competitorId")
            competitor = competitors.get(competitor_id) or {}
            rows.append(
                {
                    **game_base,
                    "team_id": competitor_id,
                    "team": team_name(competitor),
                    "stat_id": stat.get("id"),
                    "stat_name": stat.get("name"),
                    "stat_category_id": stat.get("categoryId"),
                    "stat_category_name": stat.get("categoryName"),
                    "value": stat.get("value"),
                    "value_percentage": stat.get("valuePercentage"),
                    "is_major": stat.get("isMajor"),
                    "is_primary": stat.get("isPrimary"),
                    "is_top": stat.get("isTop"),
                }
            )
    return rows


def write_csv(path: Path, rows: List[Dict[str, Any]]) -> None:
    ensure_dir(path.parent)
    fieldnames = sorted({key for row in rows for key in row.keys()})
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def summarize(rows: List[Dict[str, Any]], key: str) -> List[Any]:
    return sorted({row.get(key) for row in rows if row.get(key) is not None})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch and flatten Israeli football data from 365Scores.")
    parser.add_argument("--competition-id", type=int, default=DEFAULT_COMPETITION_ID)
    parser.add_argument(
        "--all-israeli-competitions",
        action="store_true",
        help="Discover and ingest every Israeli football competition returned by the source.",
    )
    parser.add_argument(
        "--competition-ids",
        help="Optional comma-separated competition IDs to select when using --all-israeli-competitions.",
    )
    parser.add_argument("--start-date", default=DEFAULT_START_DATE)
    parser.add_argument("--end-date", default=DEFAULT_END_DATE)
    parser.add_argument("--lang-id", type=int, default=DEFAULT_LANG_ID)
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--user-country-id", type=int, default=DEFAULT_USER_COUNTRY_ID)
    parser.add_argument("--app-type-id", type=int, default=DEFAULT_APP_TYPE_ID)
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw/365scores"))
    parser.add_argument("--processed-dir", type=Path, default=Path("data/processed"))
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit matches fetched (per competition in all-competition mode); useful while iterating.",
    )
    parser.add_argument("--walk-pages", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--max-fixture-pages", type=int, default=50)
    parser.add_argument("--sleep", type=float, default=0.25)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--workers", type=int, default=6, help="Concurrent match-detail requests.")
    parser.add_argument(
        "--fixtures-only",
        action="store_true",
        help="Fetch the competition and match catalog without match detail/stat payloads.",
    )
    parser.add_argument(
        "--include-unplayed-payloads",
        action="store_true",
        help="Also request match detail/stat payloads for matches that have not ended.",
    )
    parser.add_argument(
        "--allow-fetch-failures",
        action="store_true",
        help="Write partial outputs and exit successfully when some match payloads fail.",
    )
    parser.add_argument("--refresh", action="store_true", help="Ignore cached raw JSON files.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ensure_dir(args.raw_dir)
    ensure_dir(args.processed_dir)

    catalog_failures: List[Dict[str, Any]] = []
    if args.all_israeli_competitions:
        competitions = collect_competition_catalog(args, args.raw_dir)
        if args.competition_ids:
            selected_ids = {int(value.strip()) for value in args.competition_ids.split(",") if value.strip()}
            competitions = [competition for competition in competitions if competition["id"] in selected_ids]
    else:
        competitions = [
            {
                "id": args.competition_id,
                "name": "Israeli Premier League" if args.competition_id == 42 else f"Competition {args.competition_id}",
                "source_name": "Premier League" if args.competition_id == 42 else f"Competition {args.competition_id}",
                "competition_type": "league",
                "gender": "men",
                "age_group": "senior",
                "current_season_num": None,
                "has_stats": True,
                "has_history": args.competition_id == 42,
                "has_standings": True,
                "has_brackets": False,
            }
        ]

    if not competitions:
        raise SystemExit("no competitions selected")

    all_games: Dict[int, Dict[str, Any]] = {}
    details: Dict[int, Dict[str, Any]] = {}
    stats: Dict[int, Dict[str, Any]] = {}
    failures: List[Dict[str, Any]] = []
    fixture_pages: List[Dict[str, Any]] = []
    competition_manifests: List[Dict[str, Any]] = []

    for competition in competitions:
        competition_id = int(competition["id"])
        competition_args = argparse.Namespace(**{**vars(args), "competition_id": competition_id})
        competition_raw_dir = (
            args.raw_dir / "competitions" / str(competition_id)
            if args.all_israeli_competitions
            else args.raw_dir
        )
        print(f"discovering {competition['name']} ({competition_id})", flush=True)
        try:
            games, fixture_payload = collect_fixtures(competition_args, competition_raw_dir)
        except RuntimeError as exc:
            failure = {"competition_id": competition_id, "kind": "fixtures", "error": str(exc)}
            if not args.allow_fetch_failures:
                raise
            failures.append(failure)
            games = []
            fixture_payload = {"pages": []}

        games = sorted(
            {int(game["id"]): game for game in games if game.get("id") is not None}.values(),
            key=lambda game: game.get("startTime") or "",
        )
        if args.limit:
            games = games[: args.limit]
        all_games.update({int(game["id"]): game for game in games})

        history: List[Dict[str, Any]] = []
        if competition.get("has_history"):
            try:
                history = collect_competition_history(competition_args, competition_raw_dir, competition_id)
            except RuntimeError as exc:
                catalog_failures.append(
                    {"competition_id": competition_id, "kind": "history", "error": str(exc)}
                )

        competition_manifest = {
            **competition,
            "seasons": competition_seasons(competition, games, history),
            "source_history_seasons": [
                season for season in history if season.get("has_table") or season.get("has_group")
            ],
        }
        competition_manifests.append(competition_manifest)
        fixture_pages.append(
            {
                "competition_id": competition_id,
                "page_count": len(fixture_payload.get("pages") or []),
                "pages": fixture_payload.get("pages") or [],
            }
        )

        if args.fixtures_only:
            continue
        payload_games = (
            [
                game
                for game in games
                if args.include_unplayed_payloads or game.get("statusGroup") == 4
            ]
            if competition.get("has_stats")
            else []
        )
        print(
            f"fetching details for {len(payload_games)} completed {competition['name']} matches",
            flush=True,
        )
        competition_details, competition_stats, competition_failures = collect_match_payloads(
            competition_args,
            competition_raw_dir,
            payload_games,
            fetch_team_stats=True,
        )
        details.update(competition_details)
        stats.update(competition_stats)
        failures.extend(
            {**failure, "competition_id": competition_id}
            for failure in competition_failures
        )

    games = sorted(all_games.values(), key=lambda game: game.get("startTime") or "")
    fixture_rows = flatten_fixtures(games)
    player_rows, stat_names = flatten_player_match_rows(details)
    team_stat_rows = flatten_team_stats(stats)

    write_csv(args.processed_dir / "365scores_fixtures.csv", fixture_rows)
    write_csv(args.processed_dir / "365scores_player_match_stats.csv", player_rows)
    write_csv(args.processed_dir / "365scores_team_match_stats.csv", team_stat_rows)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "competition_id": args.competition_id if not args.all_israeli_competitions else None,
        "all_israeli_competitions": args.all_israeli_competitions,
        "competitions": competition_manifests,
        "start_date": args.start_date,
        "end_date": args.end_date,
        "raw_dir": str(args.raw_dir),
        "processed_dir": str(args.processed_dir),
        "fixture_count": len(games),
        "match_detail_count": len(details),
        "match_team_stats_count": len(stats),
        "player_match_row_count": len(player_rows),
        "team_stat_row_count": len(team_stat_rows),
        "season_nums": summarize(fixture_rows, "season_num"),
        "stage_nums": summarize(fixture_rows, "stage_num"),
        "round_nums": summarize(fixture_rows, "round_num"),
        "player_stat_keys": stat_names,
        "failures": failures,
        "fixture_page_count": sum(item["page_count"] for item in fixture_pages),
        "fixture_pages": fixture_pages,
        "catalog_failures": catalog_failures,
        "note": (
            "Fixtures are discovered from the source's current results endpoint plus paged "
            "/web/games/ responses, then filtered to the requested date window. Source history "
            "without match payloads is retained as metadata but is not loaded as an empty season."
        ),
    }
    write_json(args.processed_dir / "365scores_manifest.json", manifest)
    print(
        json.dumps(
            {
                "competitions": [
                    {
                        "id": competition["id"],
                        "name": competition["name"],
                        "seasons": [season["name"] for season in competition["seasons"]],
                    }
                    for competition in competition_manifests
                ],
                "fixture_count": len(games),
                "match_detail_count": len(details),
                "player_match_row_count": len(player_rows),
                "team_stat_row_count": len(team_stat_rows),
                "failure_count": len(failures) + len(catalog_failures),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )
    return 0 if args.allow_fetch_failures or not failures else 1


if __name__ == "__main__":
    sys.exit(main())
