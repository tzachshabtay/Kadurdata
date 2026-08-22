#!/usr/bin/env python3
"""Build a current, source-independent census of Israeli footballers abroad."""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

try:
    from scripts.player_identity import canonical_player_name
    from scripts.sync_fotmob_loans import normalized_name, unique_name_index, upsert_mapping
    from scripts.sync_transfermarkt_loans import (
        POSITION_GROUPS,
        extract_hebrew_text,
        fetch_entities,
        get_source,
        hebrew_name,
    )
except ModuleNotFoundError:
    from player_identity import canonical_player_name
    from sync_fotmob_loans import normalized_name, unique_name_index, upsert_mapping
    from sync_transfermarkt_loans import (
        POSITION_GROUPS,
        extract_hebrew_text,
        fetch_entities,
        get_source,
        hebrew_name,
    )


ISRAEL_COUNTRY_ID = 74
SCORES365_COUNTRY_ID = 6
SCORES365_SOURCE = {
    "code": "365scores",
    "name": "365Scores",
    "kind": "unofficial_json_api_data",
    "base_url": "https://www.365scores.com",
    "priority": 20,
}
SCORES365_API = "https://webws.365scores.com"
LEGIONNAIRE_INDEX = (
    "/spieler-statistik/legionaere/statistik/stat/land/0/land_id/74/plus/0"
)
TRANSFERMARKT_WEB_BASES = (
    "https://www.transfermarkt.com",
    "https://www.transfermarkt.us",
    "https://www.transfermarkt.co.uk",
    "https://www.transfermarkt.de",
    "https://www-transfermarkt-com.translate.goog",
)
TRANSFERMARKT_TRANSLATE_BASE = "https://www-transfermarkt-com.translate.goog"
WEB_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)
PLAYER_LINK = re.compile(r"/profil/spieler/(\d+)")
CLUB_LINK = re.compile(r"/startseite/verein/(\d+)")
COMPETITION_LINK = re.compile(r"/startseite/wettbewerb/([^/?]+)")
COUNTRY_LINK = re.compile(r"/land_id/74/land/(\d+)")
PAGE_LINK = re.compile(r"/page/(\d+)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Discover every Transfermarkt-listed Israeli footballer currently abroad."
    )
    parser.add_argument("--season-name", default="")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--sleep", type=float, default=0.25)
    parser.add_argument("--limit", type=int, default=0, help="Limit players for a smoke run.")
    parser.add_argument("--allow-fetch-failures", action="store_true")
    return parser.parse_args()


def current_season_name(today: Optional[date] = None) -> str:
    current = today or date.today()
    start_year = current.year if current.month >= 7 else current.year - 1
    return f"{start_year}/{start_year + 1}"


def fetch_bytes(url: str, retries: int, sleep_seconds: float) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = Request(
                url,
                headers={
                    "Accept": "text/html,application/json",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Origin": "/".join(url.split("/")[:3]),
                    "Referer": f"{'/'.join(url.split('/')[:3])}/",
                    "User-Agent": WEB_USER_AGENT,
                },
            )
            with urlopen(request, timeout=40) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError, socket.timeout) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(sleep_seconds * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


def fetch_html(url: str, retries: int, sleep_seconds: float) -> str:
    return fetch_bytes(url, retries, sleep_seconds).decode("utf-8", errors="replace")


def transfermarkt_web_url(base: str, path: str) -> str:
    url = f"{base}{path}"
    if base == TRANSFERMARKT_TRANSLATE_BASE:
        return f"{url}?{urlencode({'_x_tr_sl': 'auto', '_x_tr_tl': 'en', '_x_tr_hl': 'en'})}"
    return url


def fetch_json(url: str, retries: int, sleep_seconds: float) -> dict[str, Any]:
    try:
        payload = json.loads(fetch_bytes(url, retries, sleep_seconds).decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid JSON from {url}: {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"unexpected JSON response from {url}")
    return payload


def max_page(soup: BeautifulSoup) -> int:
    pages = [
        int(match.group(1))
        for anchor in soup.select("a[href]")
        if (match := PAGE_LINK.search(str(anchor.get("href") or "")))
    ]
    return max(pages, default=1)


def parse_destination_countries(html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("#yw1 table.items")
    if table is None:
        raise RuntimeError("Transfermarkt legionnaire country table was not found")
    countries: dict[str, dict[str, str]] = {}
    for row in table.select("tbody > tr"):
        for anchor in row.select("a[href]"):
            match = COUNTRY_LINK.search(str(anchor.get("href") or ""))
            if match is None:
                continue
            image = anchor.select_one("img")
            name = str(
                anchor.get("title")
                or anchor.get_text(" ", strip=True)
                or (image.get("title") if image else "")
                or (image.get("alt") if image else "")
            ).strip()
            if name:
                country_id = match.group(1)
                countries[country_id] = {"country_id": country_id, "country_name": name}
                break
    return list(countries.values())


def parse_legionnaire_players(
    html: str,
    *,
    country_id: str,
    country_name: str,
) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("#yw1 table.items")
    if table is None:
        raise RuntimeError(f"Transfermarkt player table was not found for {country_name}")

    players: list[dict[str, Any]] = []
    for row in table.select("tbody > tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) < 5:
            continue
        player_anchor = next(
            (
                anchor
                for anchor in cells[1].select("a[href]")
                if PLAYER_LINK.search(str(anchor.get("href") or ""))
            ),
            None,
        )
        club_anchor = next(
            (
                anchor
                for anchor in cells[4].select("a[href]")
                if CLUB_LINK.search(str(anchor.get("href") or ""))
            ),
            None,
        )
        competition_anchor = next(
            (
                anchor
                for anchor in cells[4].select("a[href]")
                if COMPETITION_LINK.search(str(anchor.get("href") or ""))
            ),
            None,
        )
        if player_anchor is None or club_anchor is None:
            continue
        player_match = PLAYER_LINK.search(str(player_anchor.get("href") or ""))
        club_match = CLUB_LINK.search(str(club_anchor.get("href") or ""))
        competition_match = COMPETITION_LINK.search(str(competition_anchor.get("href") or "")) if competition_anchor else None
        assert player_match and club_match
        inline_rows = cells[1].select("table.inline-table tr")
        position = inline_rows[1].get_text(" ", strip=True) if len(inline_rows) > 1 else None
        players.append(
            {
                "source_player_id": player_match.group(1),
                "player_name": str(player_anchor.get("title") or player_anchor.get_text(" ", strip=True)).strip(),
                "listed_position": position,
                "source_team_id": club_match.group(1),
                "team_name": str(club_anchor.get("title") or club_anchor.get_text(" ", strip=True)).strip(),
                "source_competition_id": competition_match.group(1) if competition_match else f"country-{country_id}",
                "competition_name": str(
                    competition_anchor.get("title") or competition_anchor.get_text(" ", strip=True)
                ).strip() if competition_anchor else f"Other clubs - {country_name}",
                "destination_country_id": country_id,
                "destination_country_name": country_name,
            }
        )
    return players


def discover_players(args: argparse.Namespace) -> tuple[list[dict[str, Any]], int]:
    index_html = ""
    web_base = ""
    mirror_errors: list[str] = []
    for candidate_base in TRANSFERMARKT_WEB_BASES:
        try:
            candidate_html = fetch_html(
                transfermarkt_web_url(candidate_base, LEGIONNAIRE_INDEX),
                args.retries,
                args.sleep,
            )
            candidate_countries = parse_destination_countries(candidate_html)
        except RuntimeError as exc:
            mirror_errors.append(f"{candidate_base}: {exc}")
            continue
        if candidate_countries:
            index_html = candidate_html
            web_base = candidate_base
            break
        mirror_errors.append(f"{candidate_base}: country table was empty")
    if not web_base:
        raise RuntimeError(
            "Transfermarkt legionnaire index was unavailable on every mirror: "
            + "; ".join(mirror_errors)
        )
    index_soup = BeautifulSoup(index_html, "html.parser")
    index_pages = max_page(index_soup)
    countries = parse_destination_countries(index_html)
    for page in range(2, index_pages + 1):
        page_html = fetch_html(
            transfermarkt_web_url(web_base, f"{LEGIONNAIRE_INDEX}/page/{page}"),
            args.retries,
            args.sleep,
        )
        countries.extend(parse_destination_countries(page_html))
    countries = list({country["country_id"]: country for country in countries}.values())

    first_pages: dict[str, str] = {}
    page_tasks: list[tuple[dict[str, str], int]] = []
    for country in countries:
        path = (
            "/spieler-statistik/legionaere/statistik/stat/"
            f"land_id/74/land/{country['country_id']}/plus/0"
        )
        html = fetch_html(transfermarkt_web_url(web_base, path), args.retries, args.sleep)
        first_pages[country["country_id"]] = html
        pages = max_page(BeautifulSoup(html, "html.parser"))
        page_tasks.extend((country, page) for page in range(2, pages + 1))

    rows: list[dict[str, Any]] = []
    for country in countries:
        rows.extend(
            parse_legionnaire_players(
                first_pages[country["country_id"]],
                country_id=country["country_id"],
                country_name=country["country_name"],
            )
        )

    def fetch_country_page(task: tuple[dict[str, str], int]) -> tuple[dict[str, str], str]:
        country, page = task
        path = (
            "/spieler-statistik/legionaere/statistik/stat/"
            f"land_id/74/land/{country['country_id']}/plus/0/page/{page}"
        )
        url = transfermarkt_web_url(web_base, path)
        return country, fetch_html(url, args.retries, args.sleep)

    with ThreadPoolExecutor(max_workers=max(args.workers, 1)) as executor:
        pending = {executor.submit(fetch_country_page, task): task for task in page_tasks}
        for future in as_completed(pending):
            country, html = future.result()
            rows.extend(
                parse_legionnaire_players(
                    html,
                    country_id=country["country_id"],
                    country_name=country["country_name"],
                )
            )

    deduped = list({row["source_player_id"]: row for row in rows}.values())
    deduped.sort(key=lambda row: canonical_player_name(str(row["player_name"])))
    return (deduped[: args.limit] if args.limit > 0 else deduped), len(countries)


def scores365_search_url(player_name: str) -> str:
    params = {
        "appTypeId": 5,
        "langId": 1,
        "timezoneName": "Asia/Jerusalem",
        "userCountryId": SCORES365_COUNTRY_ID,
        "query": player_name,
    }
    return f"{SCORES365_API}/web/search/?{urlencode(params)}"


def resolve_scores365_player(
    row: dict[str, Any], retries: int, sleep_seconds: float
) -> Optional[dict[str, Any]]:
    payload = fetch_json(scores365_search_url(str(row["player_name"])), retries, sleep_seconds)
    wanted = canonical_player_name(str(row["player_name"]))
    candidates = [
        athlete
        for athlete in payload.get("athletes") or []
        if isinstance(athlete, dict)
        and int(athlete.get("nationalityId") or 0) == SCORES365_COUNTRY_ID
        and canonical_player_name(str(athlete.get("name") or "")) == wanted
    ]
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        wanted_club = normalized_name(str(row["team_name"]))
        club_matches = [
            candidate
            for candidate in candidates
            if normalized_name(str(candidate.get("clubName") or "")) == wanted_club
        ]
        return club_matches[0] if len(club_matches) == 1 else None
    return None


def ensure_source(cur: Any, source: dict[str, Any]) -> str:
    result = cur.execute(
        """
        insert into source.sources (code, name, kind, base_url, priority)
        values (%s, %s, %s, %s, %s)
        on conflict (code) do update
          set name = excluded.name,
              kind = excluded.kind,
              base_url = excluded.base_url,
              priority = excluded.priority,
              updated_at = now()
        returning id::text
        """,
        tuple(source[key] for key in ("code", "name", "kind", "base_url", "priority")),
    ).fetchone()
    return str(result["id"])


def role_from_player(player: dict[str, Any], listed_position: Optional[str]) -> Optional[str]:
    attributes = player.get("attributes") if isinstance(player.get("attributes"), dict) else {}
    group = str(attributes.get("positionGroup") or "")
    if group in POSITION_GROUPS:
        return POSITION_GROUPS[group]
    value = (listed_position or "").lower()
    if "keeper" in value:
        return "Goalkeeper"
    if "back" in value or "defender" in value:
        return "Defender"
    if "midfield" in value:
        return "Midfielder"
    if value:
        return "Attacker"
    return None


def preferred_player_index(
    rows: list[dict[str, Any]],
    key_for_row: Any,
) -> dict[Any, Optional[str]]:
    grouped: dict[Any, list[dict[str, Any]]] = {}
    for row in rows:
        key = key_for_row(row)
        if key:
            grouped.setdefault(key, []).append(row)

    preferred: dict[Any, Optional[str]] = {}
    for key, candidates in grouped.items():
        unique_candidates = {str(candidate["id"]): candidate for candidate in candidates}
        ranked = sorted(
            unique_candidates.values(),
            key=lambda candidate: (
                bool(candidate.get("has_365scores_identity")),
                bool(candidate.get("has_appearances")),
            ),
            reverse=True,
        )
        best_score = (
            bool(ranked[0].get("has_365scores_identity")),
            bool(ranked[0].get("has_appearances")),
        )
        tied = [
            candidate
            for candidate in ranked
            if (
                bool(candidate.get("has_365scores_identity")),
                bool(candidate.get("has_appearances")),
            ) == best_score
        ]
        preferred[key] = str(ranked[0]["id"]) if len(tied) == 1 else None
    return preferred


def main() -> int:
    import psycopg
    from psycopg.rows import dict_row

    args = parse_args()
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")
    season_name = args.season_name or current_season_name()

    players, country_count = discover_players(args)
    if not players:
        raise RuntimeError("Transfermarkt returned no Israeli footballers abroad")
    print(
        f"Transfermarkt census: {len(players)} players across {country_count} destination countries",
        flush=True,
    )

    transfermarkt_players = fetch_entities(
        "players",
        (row["source_player_id"] for row in players),
        args.retries,
        args.sleep,
        args.workers,
    )
    transfermarkt_clubs = fetch_entities(
        "clubs",
        (row["source_team_id"] for row in players),
        args.retries,
        args.sleep,
        args.workers,
    )
    transfermarkt_competitions = fetch_entities(
        "competitions",
        (
            row["source_competition_id"]
            for row in players
            if not str(row["source_competition_id"]).startswith("country-")
        ),
        args.retries,
        args.sleep,
        args.workers,
    )

    scores365_matches: dict[str, dict[str, Any]] = {}
    search_failures: list[str] = []
    with ThreadPoolExecutor(max_workers=max(args.workers, 1)) as executor:
        pending = {
            executor.submit(resolve_scores365_player, row, args.retries, args.sleep): row
            for row in players
        }
        for future in as_completed(pending):
            row = pending[future]
            try:
                match = future.result()
            except RuntimeError as exc:
                if not args.allow_fetch_failures:
                    raise
                search_failures.append(f"{row['player_name']}: {exc}")
                continue
            if match and match.get("id") is not None:
                scores365_matches[str(row["source_player_id"])] = match

    with psycopg.connect(database_url, row_factory=dict_row, prepare_threshold=None) as connection:
        with connection.cursor() as cur:
            transfermarkt_source_id = get_source(cur)
            scores365_source_id = ensure_source(cur, SCORES365_SOURCE)
            israel_row = cur.execute(
                "select id::text from core.countries where iso2 = 'IL' limit 1"
            ).fetchone()
            if israel_row is None:
                israel_row = cur.execute(
                    """
                    insert into core.countries (name, iso2, iso3)
                    values ('Israel', 'IL', 'ISR')
                    returning id::text
                    """
                ).fetchone()
            israel_country_id = str(israel_row["id"])

            player_rows = list(cur.execute(
                """
                select
                  player.id::text,
                  player.display_name,
                  player.display_name_he,
                  player.date_of_birth,
                  exists (
                    select 1
                    from source.source_entity_ids mapping
                    where mapping.source_id = %s
                      and mapping.entity_type = 'player'
                      and mapping.canonical_id = player.id
                  ) as has_365scores_identity,
                  exists (
                    select 1
                    from core.player_match_appearances appearance
                    where appearance.player_id = player.id
                  ) as has_appearances
                from core.players player
                """,
                (scores365_source_id,),
            ).fetchall())
            team_rows = list(cur.execute("select id::text, name from core.teams").fetchall())
            competition_rows = list(cur.execute("select id::text, name from core.competitions").fetchall())
            player_by_name = preferred_player_index(
                player_rows,
                lambda player: canonical_player_name(str(player["display_name"])),
            )
            player_by_hebrew_birth = preferred_player_index(
                player_rows,
                lambda player: (
                    extract_hebrew_text(player.get("display_name_he")),
                    str(player.get("date_of_birth") or ""),
                ) if player.get("display_name_he") and player.get("date_of_birth") else None,
            )
            team_by_name = unique_name_index(team_rows, "name", "id")
            competition_by_name = unique_name_index(competition_rows, "name", "id")

            def mappings(source_id: str, entity_type: str) -> dict[str, str]:
                return {
                    str(row["source_entity_id"]): str(row["canonical_id"])
                    for row in cur.execute(
                        """
                        select source_entity_id, canonical_id
                        from source.source_entity_ids
                        where source_id = %s and entity_type = %s and canonical_id is not null
                        """,
                        (source_id, entity_type),
                    ).fetchall()
                }

            tm_player_mapping = mappings(transfermarkt_source_id, "player")
            scores_player_mapping = mappings(scores365_source_id, "player")
            tm_team_mapping = mappings(transfermarkt_source_id, "team")
            tm_competition_mapping = mappings(transfermarkt_source_id, "competition")

            cur.execute(
                """
                update core.player_team_stints
                set metadata = metadata || '{"transfermarkt_is_current": false}'::jsonb
                where metadata ? 'transfermarkt_legionnaire_census'
                """
            )

            def ensure_player(row: dict[str, Any]) -> str:
                source_player_id = str(row["source_player_id"])
                tm_player = transfermarkt_players.get(source_player_id) or {}
                scores_player = scores365_matches.get(source_player_id)
                scores_id = str(scores_player["id"]) if scores_player else ""
                attributes = tm_player.get("attributes") if isinstance(tm_player.get("attributes"), dict) else {}
                position = attributes.get("position") if isinstance(attributes.get("position"), dict) else {}
                formation_position = str(position.get("shortName") or position.get("name") or row.get("listed_position") or "").strip() or None
                primary_position = role_from_player(tm_player, row.get("listed_position"))
                life_dates = tm_player.get("lifeDates") if isinstance(tm_player.get("lifeDates"), dict) else {}
                date_of_birth = str(life_dates.get("dateOfBirth") or "")[:10] or None
                name_he = hebrew_name(tm_player)
                canonical_id = (
                    (scores_player_mapping.get(scores_id) if scores_id else None)
                    or player_by_hebrew_birth.get((name_he, date_of_birth))
                    or player_by_name.get(canonical_player_name(str(row["player_name"])))
                    or tm_player_mapping.get(source_player_id)
                )
                metadata = json.dumps(
                    {
                        "source_country_id": SCORES365_COUNTRY_ID,
                        "transfermarkt_player_id": source_player_id,
                        "formation_position": formation_position,
                        "transfermarkt_legionnaire_census": True,
                    }
                )
                if canonical_id is None:
                    canonical_id = str(
                        cur.execute(
                            """
                            insert into core.players (
                              display_name, display_name_he, date_of_birth, country_id,
                              primary_position, metadata
                            )
                            values (%s, %s, %s, %s, %s, %s)
                            returning id::text
                            """,
                            (
                                row["player_name"],
                                name_he,
                                date_of_birth,
                                israel_country_id,
                                primary_position,
                                metadata,
                            ),
                        ).fetchone()["id"]
                    )
                    player_by_name[canonical_player_name(str(row["player_name"]))] = canonical_id
                    if name_he and date_of_birth:
                        player_by_hebrew_birth[(name_he, date_of_birth)] = canonical_id
                else:
                    cur.execute(
                        """
                        update core.players
                        set display_name_he = coalesce(nullif(display_name_he, ''), %s),
                            date_of_birth = coalesce(date_of_birth, %s),
                            country_id = %s,
                            primary_position = coalesce(primary_position, %s),
                            metadata = metadata || %s::jsonb
                        where id = %s
                        """,
                        (name_he, date_of_birth, israel_country_id, primary_position, metadata, canonical_id),
                    )
                upsert_mapping(
                    cur,
                    transfermarkt_source_id,
                    "player",
                    source_player_id,
                    "core.players",
                    canonical_id,
                    str(row["player_name"]),
                )
                cur.execute(
                    """
                    update source.source_entity_ids
                    set canonical_id = %s,
                        source_name = %s,
                        last_seen_at = now()
                    where source_id = %s
                      and entity_type = 'player'
                      and source_entity_id = %s
                      and mapping_status = 'auto'
                    """,
                    (
                        canonical_id,
                        str(row["player_name"]),
                        transfermarkt_source_id,
                        source_player_id,
                    ),
                )
                tm_player_mapping[source_player_id] = canonical_id
                if scores_id:
                    upsert_mapping(
                        cur,
                        scores365_source_id,
                        "player",
                        scores_id,
                        "core.players",
                        canonical_id,
                        str(scores_player.get("name") or row["player_name"]),
                    )
                    scores_player_mapping[scores_id] = canonical_id
                return canonical_id

            def ensure_team(row: dict[str, Any]) -> str:
                source_team_id = str(row["source_team_id"])
                club = transfermarkt_clubs.get(source_team_id) or {}
                team_name = str(club.get("name") or row["team_name"])
                canonical_id = tm_team_mapping.get(source_team_id) or team_by_name.get(normalized_name(team_name))
                logo_url = str(club.get("crestUrl") or "").strip() or None
                if canonical_id is None:
                    canonical_id = str(
                        cur.execute(
                            "insert into core.teams (name, logo_url) values (%s, %s) returning id::text",
                            (team_name, logo_url),
                        ).fetchone()["id"]
                    )
                    team_by_name[normalized_name(team_name)] = canonical_id
                else:
                    cur.execute(
                        "update core.teams set logo_url = coalesce(logo_url, %s) where id = %s",
                        (logo_url, canonical_id),
                    )
                upsert_mapping(
                    cur,
                    transfermarkt_source_id,
                    "team",
                    source_team_id,
                    "core.teams",
                    canonical_id,
                    team_name,
                )
                tm_team_mapping[source_team_id] = canonical_id
                return canonical_id

            def ensure_season(row: dict[str, Any]) -> tuple[str, str]:
                source_competition_id = str(row["source_competition_id"])
                competition = transfermarkt_competitions.get(source_competition_id) or {}
                competition_name = str(competition.get("name") or row["competition_name"])
                competition_id = (
                    tm_competition_mapping.get(source_competition_id)
                    or competition_by_name.get(normalized_name(competition_name))
                )
                base_details = competition.get("baseDetails") if isinstance(competition.get("baseDetails"), dict) else {}
                competition_type = "cup" if base_details.get("isTournament") is True else "league"
                metadata = json.dumps(
                    {
                        "scope": "foreign_club",
                        "age_group": "senior",
                        "participant_type": "club",
                        "legionnaire_league": True,
                        "transfermarkt_competition_id": source_competition_id,
                    }
                )
                if competition_id is None:
                    competition_id = str(
                        cur.execute(
                            """
                            insert into core.competitions (name, competition_type, gender, metadata)
                            values (%s, %s, 'men', %s)
                            returning id::text
                            """,
                            (competition_name, competition_type, metadata),
                        ).fetchone()["id"]
                    )
                    competition_by_name[normalized_name(competition_name)] = competition_id
                else:
                    cur.execute(
                        "update core.competitions set metadata = metadata || %s::jsonb where id = %s",
                        (metadata, competition_id),
                    )
                upsert_mapping(
                    cur,
                    transfermarkt_source_id,
                    "competition",
                    source_competition_id,
                    "core.competitions",
                    competition_id,
                    competition_name,
                )
                tm_competition_mapping[source_competition_id] = competition_id
                start_year = int(season_name.split("/", 1)[0])
                season_row = cur.execute(
                    """
                    insert into core.seasons (competition_id, name, start_date, end_date, metadata)
                    values (%s, %s, make_date(%s, 7, 1), make_date(%s, 6, 30), %s)
                    on conflict (competition_id, name) do update
                      set metadata = core.seasons.metadata || excluded.metadata
                    returning id::text
                    """,
                    (
                        competition_id,
                        season_name,
                        start_year,
                        start_year + 1,
                        json.dumps({"transfermarkt_census_season": True}),
                    ),
                ).fetchone()
                season_id = str(season_row["id"])
                upsert_mapping(
                    cur,
                    transfermarkt_source_id,
                    "season",
                    f"{source_competition_id}:{season_name}",
                    "core.seasons",
                    season_id,
                    season_name,
                )
                return competition_id, season_id

            inserted_stints = 0
            for row in players:
                player_id = ensure_player(row)
                team_id = ensure_team(row)
                _, season_id = ensure_season(row)
                cur.execute(
                    """
                    insert into core.team_seasons (team_id, season_id, display_name, metadata)
                    values (%s, %s, %s, %s)
                    on conflict (team_id, season_id) do update
                      set metadata = core.team_seasons.metadata || excluded.metadata
                    """,
                    (
                        team_id,
                        season_id,
                        row["team_name"],
                        json.dumps({"transfermarkt_legionnaire_census": True}),
                    ),
                )
                existing = cur.execute(
                    """
                    select id::text
                    from core.player_team_stints
                    where player_id = %s and team_id = %s and season_id = %s
                    order by id
                    limit 1
                    """,
                    (player_id, team_id, season_id),
                ).fetchone()
                stint_metadata = json.dumps(
                    {
                        "transfermarkt_legionnaire_census": True,
                        "transfermarkt_is_current": True,
                        "transfermarkt_player_id": row["source_player_id"],
                        "transfermarkt_team_id": row["source_team_id"],
                        "transfermarkt_competition_id": row["source_competition_id"],
                        "destination_country_id": row["destination_country_id"],
                        "destination_country_name": row["destination_country_name"],
                    }
                )
                if existing:
                    cur.execute(
                        "update core.player_team_stints set metadata = metadata || %s::jsonb where id = %s",
                        (stint_metadata, existing["id"]),
                    )
                else:
                    cur.execute(
                        """
                        insert into core.player_team_stints (player_id, team_id, season_id, metadata)
                        values (%s, %s, %s, %s::jsonb || '{"discovery":"transfermarkt_legionnaires"}'::jsonb)
                        """,
                        (player_id, team_id, season_id, stint_metadata),
                    )
                inserted_stints += 1
            connection.commit()

    unresolved = [
        str(row["player_name"])
        for row in players
        if str(row["source_player_id"]) not in scores365_matches
    ]
    print(
        "Legionnaire census synchronized: "
        f"players={len(players)}, affiliations={inserted_stints}, "
        f"365scores_matches={len(scores365_matches)}, unresolved_365scores={len(unresolved)}, "
        f"search_failures={len(search_failures)}",
        flush=True,
    )
    if unresolved:
        print("Unresolved 365Scores players: " + ", ".join(unresolved[:40]), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
