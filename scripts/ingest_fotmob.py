#!/usr/bin/env python3
"""Fetch historical Ligat Ha'Al fixtures and player-match stats from FotMob pages."""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


BASE_URL = "https://www.fotmob.com"
LEAGUE_ID = 127
LEAGUE_SLUG = "ligat-haal"
COMPETITION_NAME = "Israeli Premier League"
CURRENT_SOURCE_SEASONS = {"2025/2026", "2026/2027"}
USER_AGENT = "Mozilla/5.0 (compatible; Kadurdata/1.0; historical football data import)"
PROCESSED_DIR = Path("data/processed/fotmob")
NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>'
)

STAT_CODES = {
    "accurate passes": "passes_completed",
    "accurate long balls": "long_passes_completed",
    "accurate crosses": "crosses_completed",
    "successful dribbles": "successful_dribbles",
    "tackles won": "tackles_won",
    "ground duels won": "ground_duels_won",
    "aerial duels won": "aerial_duels_won",
    "duels won": "duels_won",
    "fotmob rating": "rating_365",
    "minutes played": "minutes",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch historical Ligat Ha'Al data from FotMob.")
    parser.add_argument(
        "--seasons",
        help="Comma-separated seasons. Blank imports every historical season not covered by 365Scores.",
    )
    parser.add_argument("--fixtures-only", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Limit matches per season for a smoke run.")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--sleep", type=float, default=0.1)
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    parser.add_argument("--allow-fetch-failures", action="store_true")
    return parser.parse_args()


def fetch_text(url: str, retries: int, sleep_seconds: float) -> str:
    error: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
            with urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8")
        except (HTTPError, URLError, TimeoutError) as exc:
            error = exc
            if attempt < retries:
                time.sleep(sleep_seconds * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {error}")


def page_props(html: str) -> dict[str, Any]:
    match = NEXT_DATA_RE.search(html)
    if not match:
        raise RuntimeError("FotMob page did not contain __NEXT_DATA__")
    return json.loads(unescape(match.group(1)))["props"]["pageProps"]


def league_url(season: Optional[str] = None) -> str:
    url = f"{BASE_URL}/leagues/{LEAGUE_ID}/overview/{LEAGUE_SLUG}"
    return f"{url}?season={quote(season)}" if season else url


def season_start_year(season: str) -> int:
    return int(season.split("/", 1)[0])


def selected_seasons(available: Iterable[str], requested: Optional[str]) -> list[str]:
    historical = [season for season in available if season not in CURRENT_SOURCE_SEASONS]
    if not requested:
        return historical
    wanted = {season.strip() for season in requested.split(",") if season.strip()}
    missing = sorted(wanted - set(available))
    if missing:
        raise SystemExit(f"FotMob does not advertise these seasons: {', '.join(missing)}")
    return [season for season in available if season in wanted]


def score_pair(status: dict[str, Any]) -> tuple[Optional[int], Optional[int]]:
    match = re.search(r"(-?\d+)\s*-\s*(-?\d+)", str(status.get("scoreStr") or ""))
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def status_text(status: dict[str, Any]) -> str:
    reason = status.get("reason") or {}
    short = str(reason.get("short") or "").lower()
    long = str(reason.get("long") or "").lower()
    if status.get("awarded"):
        return "Awarded"
    if status.get("cancelled"):
        return "Cancelled"
    if status.get("finished"):
        if "pen" in short or "pen" in long:
            return "After Penalties"
        if "aet" in short or "extra time" in long:
            return "After ET"
        return "Ended"
    if status.get("started"):
        return str(reason.get("long") or reason.get("short") or "Live")
    return "Scheduled"


def stage_and_round(match: dict[str, Any]) -> tuple[int, Optional[int], str]:
    raw = match.get("roundName") if match.get("roundName") is not None else match.get("round")
    text = str(raw or "Round")
    number_match = re.search(r"(\d+)(?!.*\d)", text)
    round_number = int(number_match.group(1)) if number_match else None
    lowered = text.lower()
    stage_num = 2 if any(word in lowered for word in ("championship", "relegation", "playoff")) else 1
    return stage_num, round_number, text


def fixture_row(match: dict[str, Any], season: str) -> dict[str, Any]:
    status = match.get("status") or {}
    home_score, away_score = score_pair(status)
    stage_num, round_num, round_name = stage_and_round(match)
    home = match.get("home") or {}
    away = match.get("away") or {}
    return {
        "game_id": match.get("id"),
        "competition_id": LEAGUE_ID,
        "season_num": season_start_year(season),
        "stage_num": stage_num,
        "round_num": round_num,
        "round_name": round_name,
        "start_time": status.get("utcTime"),
        "status_id": "",
        "status_text": status_text(status),
        "home_team_id": home.get("id"),
        "home_team": home.get("name"),
        "home_score": home_score,
        "away_team_id": away.get("id"),
        "away_team": away.get("name"),
        "away_score": away_score,
        "page_url": match.get("pageUrl"),
    }


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def metric_code(title: str, key: Optional[str]) -> str:
    return STAT_CODES.get(title.lower(), slugify(str(key or title)))


def position_name(position_id: Any) -> Optional[str]:
    return {0: "Goalkeeper", 1: "Defender", 2: "Midfielder", 3: "Attacker"}.get(position_id)


def lineup_players(lineup: Optional[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    if not lineup:
        return indexed
    for team_key in ("homeTeam", "awayTeam"):
        team = lineup.get(team_key) or {}
        for group, label in (("starters", "Started"), ("subs", "Substitute")):
            for player in team.get(group) or []:
                indexed[str(player.get("id"))] = {
                    "jersey_number": player.get("shirtNumber"),
                    "lineup_status_text": label,
                    "position_name": position_name(player.get("usualPlayingPositionId")),
                    "formation_name": team.get("formation"),
                }
    return indexed


def flatten_player_stats(
    props: dict[str, Any],
    fixture: dict[str, Any],
) -> list[dict[str, Any]]:
    content = props.get("content") or {}
    players = content.get("playerStats") or {}
    lineup = lineup_players(content.get("lineup"))
    rows: list[dict[str, Any]] = []
    for player_id, player in players.items():
        team_id = str(player.get("teamId") or "")
        home_id = str(fixture.get("home_team_id") or "")
        away_id = str(fixture.get("away_team_id") or "")
        if team_id == home_id:
            opponent_id, side = away_id, "home"
        elif team_id == away_id:
            opponent_id, side = home_id, "away"
        else:
            continue
        row: dict[str, Any] = {
            "game_id": fixture["game_id"],
            "team_id": team_id,
            "opponent_id": opponent_id,
            "team_side": side,
            "athlete_id": player_id,
            "lineup_member_id": player_id,
            "player_name": player.get("name"),
            "country_id": "",
            "position_name": "Goalkeeper" if player.get("isGoalkeeper") else None,
            "jersey_number": "",
            "lineup_status_text": "",
            "formation_name": "",
            "rating": "",
            "heatmap_url": "",
        }
        row.update(lineup.get(str(player_id), {}))
        for section in player.get("stats") or []:
            for title, item in (section.get("stats") or {}).items():
                stat = item.get("stat") or {}
                value = stat.get("value")
                if value is None or stat.get("type") == "boolean":
                    continue
                code = metric_code(title, item.get("key"))
                if code == "rating_365":
                    row["rating"] = value
                    continue
                total = stat.get("total")
                raw = str(value)
                row[f"stat_{code}_value"] = value
                if total is not None:
                    percentage = (float(value) / float(total) * 100) if float(total) else 0
                    raw = f"{value}/{total} ({percentage:.1f}%)"
                    row[f"stat_{code}_attempted"] = total
                    row[f"stat_{code}_percentage"] = round(percentage, 4)
                row[f"stat_{code}_raw"] = raw
        rows.append(row)
    return rows


def fetch_match_rows(
    fixture: dict[str, Any],
    retries: int,
    sleep_seconds: float,
) -> tuple[list[dict[str, Any]], Optional[dict[str, Any]]]:
    game_id = fixture.get("game_id")
    try:
        props = json.loads(
            fetch_text(
                f"{BASE_URL}/api/data/matchDetails?matchId={quote(str(game_id))}",
                retries,
                sleep_seconds,
            )
        )
        actual_id = str((props.get("general") or {}).get("matchId") or "")
        if actual_id and actual_id != str(game_id):
            raise RuntimeError(f"match page returned {actual_id}")
        return flatten_player_stats(props, fixture), None
    except Exception as exc:  # noqa: BLE001 - failures are recorded per source page
        return [], {"game_id": game_id, "error": str(exc)}


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
    root_props = page_props(fetch_text(league_url(), args.retries, args.sleep))
    available = root_props.get("allAvailableSeasons") or []
    seasons = selected_seasons(available, args.seasons)
    fixtures: list[dict[str, Any]] = []
    season_metadata: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for season in seasons:
        props = page_props(fetch_text(league_url(season), args.retries, args.sleep))
        matches = ((props.get("fixtures") or {}).get("allMatches") or [])
        if args.limit:
            matches = matches[: args.limit]
        season_rows = [fixture_row(match, season) for match in matches]
        fixtures.extend(season_rows)
        dates = sorted(row["start_time"][:10] for row in season_rows if row.get("start_time"))
        season_metadata.append(
            {
                "num": season_start_year(season),
                "name": season,
                "start_date": dates[0] if dates else None,
                "end_date": dates[-1] if dates else None,
                "match_count": len(season_rows),
                "is_current": False,
            }
        )
        print(f"fetched {season}: {len(season_rows)} fixtures", flush=True)

    player_rows: list[dict[str, Any]] = []
    detail_fixtures = [row for row in fixtures if row.get("status_text") in {"Ended", "After ET", "After Penalties", "Awarded"}]
    if not args.fixtures_only:
        with ThreadPoolExecutor(max_workers=max(args.workers, 1)) as executor:
            futures = {
                executor.submit(fetch_match_rows, fixture, args.retries, args.sleep): fixture
                for fixture in detail_fixtures
            }
            for future in as_completed(futures):
                rows, failure = future.result()
                player_rows.extend(rows)
                if failure:
                    failures.append(failure)

    args.processed_dir.mkdir(parents=True, exist_ok=True)
    write_csv(args.processed_dir / "fotmob_fixtures.csv", fixtures)
    write_csv(args.processed_dir / "fotmob_player_match_stats.csv", player_rows)
    manifest = {
        "source": {
            "code": "fotmob",
            "name": "FotMob",
            "kind": "unofficial_web_page_data",
            "base_url": BASE_URL,
        },
        "competitions": [
            {
                "id": LEAGUE_ID,
                "name": COMPETITION_NAME,
                "source_name": "Ligat ha'Al",
                "competition_type": "league",
                "gender": "men",
                "age_group": "senior",
                "seasons": season_metadata,
            }
        ],
        "fixture_count": len(fixtures),
        "player_row_count": len(player_rows),
        "detail_fixture_count": len(detail_fixtures) if not args.fixtures_only else 0,
        "failure_count": len(failures),
        "failures": failures,
    }
    (args.processed_dir / "fotmob_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2), encoding="utf-8"
    )
    print(json.dumps({key: manifest[key] for key in ("fixture_count", "player_row_count", "detail_fixture_count", "failure_count")}, indent=2))
    if failures and not args.allow_fetch_failures:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
