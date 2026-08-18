#!/usr/bin/env python3
"""Synchronize historical outgoing loans from Transfermarkt season pages."""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

try:
    from scripts.sync_fotmob_loans import candidate_teams, normalized_name, unique_name_index, upsert_mapping
except ModuleNotFoundError:
    from sync_fotmob_loans import candidate_teams, normalized_name, unique_name_index, upsert_mapping


BASE_URL = "https://www.transfermarkt.com"
REFERENCE_LOANS_PATH = Path(__file__).resolve().parents[1] / "data" / "reference" / "transfermarkt_loans.json"
USER_AGENT = "Mozilla/5.0 (compatible; Kadurdata/1.0; historical football loan import)"
TRANSFERMARKT_SOURCE = {
    "code": "transfermarkt",
    "name": "Transfermarkt",
    "kind": "unofficial_web_page_data",
    "base_url": BASE_URL,
    "priority": 30,
}
KNOWN_TEAM_IDS = {
    "beitar jerusalem": "3793",
    "hapoel beer sheva": "2976",
    "hapoel haifa": "810",
    "hapoel ironi kiryat shmona": "6028",
    "hapoel jerusalem": "43119",
    "hapoel petah tikva": "262",
    "hapoel ramat gan givatayim": "2785",
    "hapoel tel aviv": "1017",
    "ihoud bnei sakhnin": "4769",
    "ironi tiberias": "51070",
    "maccabi bnei raina": "70178",
    "maccabi haifa": "1064",
    "maccabi netanya": "5223",
    "maccabi petah tikva": "3785",
    "maccabi tel aviv": "119",
    "sc ashdod": "6105",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synchronize historical Transfermarkt player loans.")
    parser.add_argument("--lookback-years", type=int, default=2)
    parser.add_argument("--limit", type=int, default=0, help="Limit parent clubs for a smoke run.")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--sleep", type=float, default=0.2)
    parser.add_argument("--allow-fetch-failures", action="store_true")
    return parser.parse_args()


def fetch_text(url: str, retries: int, sleep_seconds: float) -> str:
    error: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
            with urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8", "ignore")
        except (HTTPError, URLError, TimeoutError) as exc:
            error = exc
            if attempt < retries:
                time.sleep(sleep_seconds * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {error}")


def path_entity_id(path: str, entity_name: str) -> Optional[str]:
    match = re.search(rf"/{entity_name}/(\d+)(?:/|$)", path)
    return match.group(1) if match else None


def transfermarkt_team_suggestions(html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    suggestions: dict[str, dict[str, str]] = {}
    for link in soup.select('a[href*="/startseite/verein/"]'):
        team_id = path_entity_id(str(link.get("href") or ""), "verein")
        name = str(link.get("title") or link.get_text(" ", strip=True)).strip()
        if team_id and name:
            suggestions[team_id] = {"id": team_id, "name": name, "href": str(link["href"])}
    return list(suggestions.values())


def select_team_suggestion(suggestions: list[dict[str, str]], team_name: str) -> Optional[dict[str, str]]:
    wanted = normalized_name(team_name)
    exact = [item for item in suggestions if normalized_name(item["name"]) == wanted]
    if exact:
        return exact[0]
    return suggestions[0] if len(suggestions) == 1 else None


def resolve_transfermarkt_team(team_name: str, retries: int, sleep_seconds: float) -> Optional[dict[str, str]]:
    normalized = normalized_name(team_name)
    if normalized in KNOWN_TEAM_IDS:
        return {"id": KNOWN_TEAM_IDS[normalized], "name": team_name, "href": ""}
    url = f"{BASE_URL}/schnellsuche/ergebnis/schnellsuche?query={quote(normalized)}"
    return select_team_suggestion(transfermarkt_team_suggestions(fetch_text(url, retries, sleep_seconds)), team_name)


def primary_position(position: str) -> Optional[str]:
    value = position.lower()
    if "keeper" in value:
        return "Goalkeeper"
    if any(token in value for token in ("back", "defender")):
        return "Defender"
    if "midfield" in value:
        return "Midfielder"
    if any(token in value for token in ("winger", "striker", "forward")):
        return "Attacker"
    return None


def extract_departure_loans(html: str, parent_team: dict[str, Any], season_start_year: int) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    departure_box = None
    for box in soup.select("div.box"):
        heading = box.select_one("h2, .content-box-headline")
        if heading and heading.get_text(" ", strip=True).lower().startswith("departures"):
            departure_box = box
            break
    if departure_box is None:
        return []

    loans: list[dict[str, Any]] = []
    for row in departure_box.select("table.items > tbody > tr"):
        transfer_link = next((
            link for link in row.select("a[href]")
            if link.get_text(" ", strip=True).lower() == "loan transfer"
        ), None)
        player_link = row.select_one('a[href*="/profil/spieler/"]')
        if transfer_link is None or player_link is None:
            continue
        source_player_id = path_entity_id(str(player_link.get("href") or ""), "spieler")
        destination_links = row.select('a[href*="/startseite/verein/"]')
        destination_link = destination_links[-1] if destination_links else None
        source_destination_team_id = path_entity_id(str(destination_link.get("href") or ""), "verein") if destination_link else None
        if not source_player_id or not source_destination_team_id or destination_link is None:
            continue
        player_table = player_link.find_parent("table")
        player_rows = player_table.select(":scope > tbody > tr, :scope > tr") if player_table else []
        position = player_rows[1].get_text(" ", strip=True) if len(player_rows) > 1 else ""
        loans.append({
            "source_player_id": source_player_id,
            "player_name": str(player_link.get("title") or player_link.get_text(" ", strip=True)).strip(),
            "source_parent_team_id": str(parent_team["transfermarkt_team_id"]),
            "parent_team_name": str(parent_team["team_name"]),
            "source_destination_team_id": source_destination_team_id,
            "destination_team_name": str(destination_link.get("title") or destination_link.get_text(" ", strip=True)).strip(),
            "season_start_year": season_start_year,
            "primary_position": primary_position(position),
            "formation_position": position or None,
            "transfer_detail_url": urljoin(BASE_URL, str(transfer_link.get("href") or "")),
        })
    return loans


def extract_transfer_date(html: str) -> Optional[date]:
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    match = re.search(r"Transfer date\s+Season\s+\d{2}/\d{2}\s*-\s*(\d{2}/\d{2}/\d{4})", text)
    if not match:
        return None
    return datetime.strptime(match.group(1), "%d/%m/%Y").date()


def reference_loans(start_years: list[int], parent_team_ids: set[str]) -> list[dict[str, Any]]:
    if not REFERENCE_LOANS_PATH.exists():
        return []
    rows = json.loads(REFERENCE_LOANS_PATH.read_text(encoding="utf-8"))
    return [
        row for row in rows
        if int(row.get("season_start_year") or 0) in start_years
        and str(row.get("source_parent_team_id") or "") in parent_team_ids
    ]


def get_source(cur: Any) -> str:
    row = cur.execute(
        """
        insert into source.sources (code, name, kind, base_url, priority)
        values (%s, %s, %s, %s, %s)
        on conflict (code) do update
          set name = excluded.name,
              kind = excluded.kind,
              base_url = excluded.base_url,
              priority = excluded.priority,
              updated_at = now()
        returning id
        """,
        tuple(TRANSFERMARKT_SOURCE[key] for key in ("code", "name", "kind", "base_url", "priority")),
    ).fetchone()
    return str(row["id"])


def season_start_years(lookback_years: int) -> list[int]:
    today = date.today()
    current_start = today.year if today.month >= 7 else today.year - 1
    count = max(lookback_years, 1)
    return list(range(current_start - count + 1, current_start + 1))


def main() -> int:
    import psycopg
    from psycopg.rows import dict_row

    args = parse_args()
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    failures: list[dict[str, str]] = []
    with psycopg.connect(database_url, row_factory=dict_row, prepare_threshold=None) as connection:
        with connection.cursor() as cur:
            source_id = get_source(cur)
            teams = candidate_teams(cur, source_id, args.lookback_years)
            if args.limit > 0:
                teams = teams[:args.limit]

            resolved_teams: list[dict[str, Any]] = []
            for team in teams:
                source_team_id = str(team.get("fotmob_team_id") or "")
                suggestion = None
                if not source_team_id:
                    try:
                        suggestion = resolve_transfermarkt_team(str(team["team_name"]), args.retries, args.sleep)
                    except RuntimeError as exc:
                        failures.append({"team": str(team["team_name"]), "error": str(exc)})
                    if not suggestion:
                        continue
                    source_team_id = suggestion["id"]
                upsert_mapping(cur, source_id, "team", source_team_id, "core.teams", str(team["canonical_team_id"]), str(team["team_name"]))
                resolved_teams.append({**team, "transfermarkt_team_id": source_team_id})
            connection.commit()

            seasons = season_start_years(args.lookback_years)

            def fetch_team_season(team: dict[str, Any], start_year: int) -> list[dict[str, Any]]:
                source_team_id = str(team["transfermarkt_team_id"])
                slug = normalized_name(str(team["team_name"])).replace(" ", "-")
                url = f"{BASE_URL}/{quote(slug)}/transfers/verein/{source_team_id}/saison_id/{start_year}/pos//detailpos/0/w_s//plus/1"
                return extract_departure_loans(fetch_text(url, args.retries, args.sleep), team, start_year)

            loan_stubs: list[dict[str, Any]] = []
            with ThreadPoolExecutor(max_workers=max(args.workers, 1)) as executor:
                pending = {
                    executor.submit(fetch_team_season, team, start_year): (team, start_year)
                    for team in resolved_teams for start_year in seasons
                }
                for future in as_completed(pending):
                    team, start_year = pending[future]
                    try:
                        loan_stubs.extend(future.result())
                    except RuntimeError as exc:
                        failures.append({"team": f"{team['team_name']} {start_year}", "error": str(exc)})

            loan_stubs.extend(reference_loans(
                seasons,
                {str(team["transfermarkt_team_id"]) for team in resolved_teams},
            ))

            transfer_dates: dict[str, date] = {}

            def fetch_transfer_date(url: str) -> tuple[str, Optional[date]]:
                return url, extract_transfer_date(fetch_text(url, args.retries, args.sleep))

            detail_urls = sorted({loan["transfer_detail_url"] for loan in loan_stubs if not loan.get("started_on")})
            with ThreadPoolExecutor(max_workers=max(args.workers, 1)) as executor:
                pending = {executor.submit(fetch_transfer_date, url): url for url in detail_urls}
                for future in as_completed(pending):
                    url = pending[future]
                    try:
                        _, started_on = future.result()
                    except RuntimeError as exc:
                        failures.append({"team": url, "error": str(exc)})
                        continue
                    if started_on:
                        transfer_dates[url] = started_on

            if failures and not args.allow_fetch_failures:
                details = "\n".join(f"- {item['team']}: {item['error']}" for item in failures)
                raise RuntimeError(f"failed to fetch {len(failures)} Transfermarkt pages:\n{details}")

            team_rows = list(cur.execute("select id::text, name from core.teams").fetchall())
            player_rows = list(cur.execute("select id::text, display_name from core.players").fetchall())
            team_by_name = unique_name_index(team_rows, "name", "id")
            player_by_name = unique_name_index(player_rows, "display_name", "id")
            team_mapping = {
                str(row["source_entity_id"]): str(row["canonical_id"])
                for row in cur.execute(
                    "select source_entity_id, canonical_id from source.source_entity_ids where source_id = %s and entity_type = 'team' and canonical_id is not null",
                    (source_id,),
                ).fetchall()
            }
            player_mapping = {
                str(row["source_entity_id"]): str(row["canonical_id"])
                for row in cur.execute(
                    "select source_entity_id, canonical_id from source.source_entity_ids where source_id = %s and entity_type = 'player' and canonical_id is not null",
                    (source_id,),
                ).fetchall()
            }

            def ensure_team(source_team_id: str, team_name: str) -> str:
                canonical_id = team_mapping.get(source_team_id) or team_by_name.get(normalized_name(team_name))
                if canonical_id is None:
                    row = cur.execute("insert into core.teams (name) values (%s) returning id::text", (team_name,)).fetchone()
                    canonical_id = str(row["id"])
                    team_by_name[normalized_name(team_name)] = canonical_id
                upsert_mapping(cur, source_id, "team", source_team_id, "core.teams", canonical_id, team_name)
                team_mapping[source_team_id] = canonical_id
                return canonical_id

            def ensure_player(loan: dict[str, Any]) -> str:
                source_player_id = str(loan["source_player_id"])
                player_name = str(loan["player_name"])
                canonical_id = player_mapping.get(source_player_id) or player_by_name.get(normalized_name(player_name))
                metadata = {"formation_position": loan.get("formation_position"), "transfermarkt_loan_import": True}
                if canonical_id is None:
                    row = cur.execute(
                        "insert into core.players (display_name, primary_position, metadata) values (%s, %s, %s) returning id::text",
                        (player_name, loan.get("primary_position"), json.dumps(metadata)),
                    ).fetchone()
                    canonical_id = str(row["id"])
                    player_by_name[normalized_name(player_name)] = canonical_id
                else:
                    cur.execute(
                        "update core.players set primary_position = coalesce(primary_position, %s), metadata = metadata || %s::jsonb where id = %s",
                        (loan.get("primary_position"), json.dumps(metadata), canonical_id),
                    )
                upsert_mapping(cur, source_id, "player", source_player_id, "core.players", canonical_id, player_name)
                player_mapping[source_player_id] = canonical_id
                return canonical_id

            fetched_loans: dict[tuple[str, str, str, date], dict[str, Any]] = {}
            for loan in loan_stubs:
                fallback_date = date(int(loan["season_start_year"]), 7, 1)
                started_on = date.fromisoformat(str(loan["started_on"])) if loan.get("started_on") else transfer_dates.get(str(loan["transfer_detail_url"]), fallback_date)
                fetched_loans[(loan["source_player_id"], loan["source_parent_team_id"], loan["source_destination_team_id"], started_on)] = {
                    **loan,
                    "started_on": started_on,
                    "ended_on": date(int(loan["season_start_year"]) + 1, 6, 30),
                }

            for loan in fetched_loans.values():
                player_id = ensure_player(loan)
                parent_team_id = ensure_team(loan["source_parent_team_id"], loan["parent_team_name"])
                destination_team_id = ensure_team(loan["source_destination_team_id"], loan["destination_team_name"])
                cur.execute(
                    """
                    insert into obs.player_loans as existing (
                      source_id, player_id, parent_team_id, destination_team_id,
                      source_player_id, source_parent_team_id, source_destination_team_id,
                      parent_team_name, destination_team_name, started_on, ended_on, observed_at, metadata
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), %s)
                    on conflict (source_id, source_player_id, source_parent_team_id, source_destination_team_id, started_on) do update
                      set player_id = excluded.player_id,
                          parent_team_id = excluded.parent_team_id,
                          destination_team_id = excluded.destination_team_id,
                          parent_team_name = excluded.parent_team_name,
                          destination_team_name = excluded.destination_team_name,
                          ended_on = excluded.ended_on,
                          observed_at = now(),
                          metadata = excluded.metadata
                    """,
                    (
                        source_id, player_id, parent_team_id, destination_team_id,
                        loan["source_player_id"], loan["source_parent_team_id"], loan["source_destination_team_id"],
                        loan["parent_team_name"], loan["destination_team_name"], loan["started_on"], loan["ended_on"],
                        json.dumps({
                            "formation_position": loan.get("formation_position"),
                            "season_start_year": loan["season_start_year"],
                            "transfer_detail_url": loan["transfer_detail_url"],
                        }),
                    ),
                )
            connection.commit()

    print(
        f"Transfermarkt loans synchronized: {len(fetched_loans)} records from {len(resolved_teams)} clubs "
        f"across {len(seasons)} seasons"
        + (f" ({len(failures)} fetch failures allowed)" if failures else ""),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
