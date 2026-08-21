#!/usr/bin/env python3
"""Synchronize outgoing loans from Transfermarkt's machine-readable club history API."""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from difflib import SequenceMatcher
from typing import Any, Iterable, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from scripts.player_identity import canonical_player_name
    from scripts.sync_fotmob_loans import candidate_teams, normalized_name, unique_name_index, upsert_mapping
except ModuleNotFoundError:
    from player_identity import canonical_player_name
    from sync_fotmob_loans import candidate_teams, normalized_name, unique_name_index, upsert_mapping


BASE_URL = "https://www.transfermarkt.com"
API_BASE_URL = "https://tmapi-alpha.transfermarkt.technology"
USER_AGENT = "Mozilla/5.0 (compatible; Kadurdata/1.0; football loan import)"
TRANSFERMARKT_SOURCE = {
    "code": "transfermarkt",
    "name": "Transfermarkt",
    "kind": "unofficial_json_api_data",
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
POSITION_GROUPS = {
    "GOALKEEPER": "Goalkeeper",
    "DEFENDER": "Defender",
    "MIDFIELDER": "Midfielder",
    "FORWARD": "Attacker",
}
TEAM_SEARCH_STOP_WORDS = {"as", "fc", "sc", "afc", "cf", "ms", "ironi"}
TEAM_SEARCH_REPLACEMENTS = {
    "hertzliya": "herzliya",
    "kassem": "qasem",
}


class TransfermarktNotFound(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synchronize Transfermarkt player loans for Israeli clubs.")
    parser.add_argument("--lookback-years", type=int, default=2)
    parser.add_argument("--limit", type=int, default=0, help="Limit parent clubs for a smoke run.")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--sleep", type=float, default=0.2)
    parser.add_argument("--allow-fetch-failures", action="store_true")
    return parser.parse_args()


def normalized_team_name(value: str) -> str:
    tokens = normalized_name(value).split()
    return " ".join(token for token in tokens if token not in {"fc", "sc", "afc", "cf"})


def unique_player_name_index(rows: list[dict[str, Any]]) -> dict[str, Optional[str]]:
    grouped: dict[str, list[str]] = {}
    for row in rows:
        grouped.setdefault(canonical_player_name(str(row["display_name"])), []).append(str(row["id"]))
    return {name: ids[0] if len(set(ids)) == 1 else None for name, ids in grouped.items()}


def team_search_terms(value: str) -> list[str]:
    normalized = normalized_team_name(value)
    replaced = " ".join(TEAM_SEARCH_REPLACEMENTS.get(token, token) for token in normalized.split())
    shortened = " ".join(token for token in replaced.split() if token not in TEAM_SEARCH_STOP_WORDS)
    return list(dict.fromkeys(term for term in (normalized, replaced, shortened) if term))


def fetch_json(url: str, retries: int, sleep_seconds: float) -> dict[str, Any]:
    error: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            request = Request(
                url,
                headers={
                    "Accept": "application/json",
                    "Origin": BASE_URL,
                    "Referer": f"{BASE_URL}/",
                    "User-Agent": USER_AGENT,
                },
            )
            with urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, dict) or payload.get("success") is not True or not isinstance(payload.get("data"), (dict, list)):
                raise RuntimeError(f"unexpected Transfermarkt API response from {url}")
            return payload
        except HTTPError as exc:
            if exc.code == 404:
                raise TransfermarktNotFound(f"Transfermarkt has no API record for {url}") from exc
            error = exc
            if attempt < retries:
                time.sleep(sleep_seconds * (attempt + 1))
        except (URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as exc:
            error = exc
            if attempt < retries:
                time.sleep(sleep_seconds * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {error}")


def api_url(path: str, params: Optional[list[tuple[str, str]]] = None) -> str:
    url = f"{API_BASE_URL}/{path.lstrip('/')}"
    return f"{url}?{urlencode(params)}" if params else url


def batched(values: Iterable[str], size: int = 40) -> list[list[str]]:
    items = list(dict.fromkeys(str(value) for value in values if str(value)))
    return [items[index:index + size] for index in range(0, len(items), size)]


def fetch_entities(kind: str, entity_ids: Iterable[str], retries: int, sleep_seconds: float, workers: int) -> dict[str, dict[str, Any]]:
    chunks = batched(entity_ids)
    if not chunks:
        return {}

    def fetch_chunk(ids: list[str]) -> list[dict[str, Any]]:
        payload = fetch_json(api_url(kind, [("ids[]", entity_id) for entity_id in ids]), retries, sleep_seconds)
        rows = payload["data"]
        if not isinstance(rows, list):
            raise RuntimeError(f"Transfermarkt {kind} response was not a list")
        return [row for row in rows if isinstance(row, dict) and row.get("id")]

    entities: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=max(workers, 1)) as executor:
        pending = [executor.submit(fetch_chunk, chunk) for chunk in chunks]
        for future in as_completed(pending):
            for entity in future.result():
                entities[str(entity["id"])] = entity
    return entities


def select_team_suggestion(suggestions: list[dict[str, Any]], team_name: str) -> Optional[dict[str, Any]]:
    wanted = normalized_team_name(team_name)
    eligible = []
    for item in suggestions:
        base_details = item.get("baseDetails") if isinstance(item.get("baseDetails"), dict) else {}
        country_id = int(base_details.get("countryId") or 0)
        if country_id in {0, 74}:
            eligible.append(item)
    exact = [item for item in eligible if normalized_team_name(str(item.get("name") or "")) == wanted]
    if exact:
        return exact[0]

    wanted_tokens = set(wanted.split())
    ranked: list[tuple[float, dict[str, Any]]] = []
    for item in eligible:
        candidate = normalized_team_name(str(item.get("name") or ""))
        candidate_tokens = set(candidate.split())
        if not candidate_tokens or "u19" in candidate_tokens or "women" in candidate_tokens:
            continue
        overlap = 2 * len(wanted_tokens & candidate_tokens) / max(len(wanted_tokens) + len(candidate_tokens), 1)
        similarity = SequenceMatcher(None, wanted, candidate).ratio()
        ranked.append((max(overlap, similarity), item))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return ranked[0][1] if ranked and ranked[0][0] >= 0.72 else None


def resolve_transfermarkt_team(team_name: str, retries: int, sleep_seconds: float) -> Optional[dict[str, Any]]:
    normalized = normalized_name(team_name)
    if normalized in KNOWN_TEAM_IDS:
        return {"id": KNOWN_TEAM_IDS[normalized], "name": team_name}

    suggestions: dict[str, dict[str, Any]] = {}
    for term in team_search_terms(team_name):
        search = fetch_json(api_url("quick-search", [("term", term)]), retries, sleep_seconds)
        result = search["data"].get("result") if isinstance(search["data"], dict) else None
        club_ids = result.get("clubIds") if isinstance(result, dict) else None
        if isinstance(club_ids, list) and club_ids:
            suggestions.update(fetch_entities("clubs", club_ids, retries, sleep_seconds, 2))
        selected = select_team_suggestion(list(suggestions.values()), team_name)
        if selected:
            return selected
    return None


def parse_api_date(value: Any) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def extract_api_departure_loans(
    payload: dict[str, Any],
    parent_team: dict[str, Any],
    season_start_year: int,
    today: Optional[date] = None,
) -> list[dict[str, Any]]:
    data = payload.get("data")
    if not isinstance(data, dict) or str(data.get("clubId") or "") != str(parent_team["transfermarkt_team_id"]):
        raise RuntimeError(f"Transfermarkt history did not match club {parent_team['transfermarkt_team_id']}")
    departures = data.get("departures")
    if not isinstance(departures, dict) or not isinstance(departures.get("terminated"), list):
        raise RuntimeError(f"Transfermarkt history had no departures for club {parent_team['transfermarkt_team_id']}")

    loans: list[dict[str, Any]] = []
    records = [*departures["terminated"], *(departures.get("pending") or [])]
    current_date = today or date.today()
    for record in records:
        details = record.get("details") if isinstance(record, dict) else None
        transfer_type = record.get("typeDetails") if isinstance(record, dict) else None
        source = record.get("transferSource") if isinstance(record, dict) else None
        destination = record.get("transferDestination") if isinstance(record, dict) else None
        if not all(isinstance(value, dict) for value in (details, transfer_type, source, destination)):
            continue
        if str(transfer_type.get("type") or "") != "ACTIVE_LOAN_TRANSFER":
            continue
        if int(details.get("seasonId") or 0) != season_start_year or details.get("isPending") is True:
            continue
        started_on = parse_api_date(details.get("date"))
        if started_on is None or started_on > current_date:
            continue
        player_id = str(details.get("playerId") or "")
        source_team_id = str(source.get("clubId") or "")
        destination_team_id = str(destination.get("clubId") or "")
        if not player_id or source_team_id != str(parent_team["transfermarkt_team_id"]) or not destination_team_id:
            continue
        relative_url = str(record.get("relativeUrl") or "")
        loans.append({
            "source_transfer_id": str(record.get("id") or ""),
            "source_player_id": player_id,
            "source_parent_team_id": source_team_id,
            "parent_team_name": str(parent_team["team_name"]),
            "source_destination_team_id": destination_team_id,
            "season_start_year": season_start_year,
            "started_on": started_on,
            "transfer_detail_url": f"{BASE_URL}{relative_url}" if relative_url else BASE_URL,
        })
    return loans


def extract_hebrew_text(value: Any) -> Optional[str]:
    if not value:
        return None
    words = re.findall(
        r"[\u0590-\u05ff]+(?:[ '\u05f3\u05f4\-\u05be]+[\u0590-\u05ff]+)*",
        str(value),
    )
    cleaned = " ".join(word.strip() for word in words if word.strip()).strip()
    return cleaned or None


def hebrew_name(player: dict[str, Any]) -> Optional[str]:
    nationality = player.get("nationalityDetails")
    value = nationality.get("passportName") if isinstance(nationality, dict) else None
    return extract_hebrew_text(value)


def enrich_loan_stubs(
    stubs: list[dict[str, Any]],
    players: dict[str, dict[str, Any]],
    clubs: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    missing: list[str] = []
    for stub in stubs:
        source_player_id = str(stub["source_player_id"])
        destination_team_id = str(stub["source_destination_team_id"])
        player = players.get(source_player_id)
        club = clubs.get(destination_team_id)
        if player is None or club is None:
            missing.append(f"player {source_player_id}" if player is None else f"club {destination_team_id}")
            continue
        attributes = player.get("attributes") if isinstance(player.get("attributes"), dict) else {}
        position = attributes.get("position") if isinstance(attributes.get("position"), dict) else {}
        position_group = str(attributes.get("positionGroup") or "")
        formation_position = str(position.get("name") or "").strip() or None
        player_name = str(player.get("name") or player.get("shortName") or "").strip()
        destination_name = str(club.get("name") or "").strip()
        if not player_name or not destination_name:
            missing.append(f"metadata for player {source_player_id} / club {destination_team_id}")
            continue
        enriched.append({
            **stub,
            "player_name": player_name,
            "player_name_he": hebrew_name(player),
            "destination_team_name": destination_name,
            "primary_position": POSITION_GROUPS.get(position_group),
            "formation_position": formation_position,
            "ended_on": date(int(stub["season_start_year"]) + 1, 6, 30),
        })
    if missing:
        sample = ", ".join(missing[:10])
        raise RuntimeError(f"Transfermarkt entity enrichment missed {len(missing)} records: {sample}")
    return enriched


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
    unsupported_teams: list[str] = []
    unsupported_team_seasons: list[str] = []
    duplicate_candidate_teams: list[str] = []
    with psycopg.connect(database_url, row_factory=dict_row, prepare_threshold=None) as connection:
        with connection.cursor() as cur:
            source_id = get_source(cur)
            teams = candidate_teams(cur, source_id, args.lookback_years)
            if args.limit > 0:
                teams = teams[:args.limit]
            teams.sort(key=lambda team: (not bool(team.get("fotmob_team_id")), str(team["team_name"])))

            resolved_teams: list[dict[str, Any]] = []
            resolved_source_team_ids: set[str] = set()
            for team in teams:
                source_team_id = str(team.get("fotmob_team_id") or "")
                if not source_team_id:
                    try:
                        suggestion = resolve_transfermarkt_team(str(team["team_name"]), args.retries, args.sleep)
                    except RuntimeError as exc:
                        failures.append({"team": str(team["team_name"]), "error": str(exc)})
                        continue
                    if not suggestion:
                        unsupported_teams.append(str(team["team_name"]))
                        continue
                    source_team_id = str(suggestion["id"])
                if source_team_id in resolved_source_team_ids:
                    duplicate_candidate_teams.append(str(team["team_name"]))
                    continue
                upsert_mapping(cur, source_id, "team", source_team_id, "core.teams", str(team["canonical_team_id"]), str(team["team_name"]))
                resolved_teams.append({**team, "transfermarkt_team_id": source_team_id})
                resolved_source_team_ids.add(source_team_id)
            connection.commit()

            seasons = season_start_years(args.lookback_years)

            def fetch_team_season(team: dict[str, Any], start_year: int) -> Optional[list[dict[str, Any]]]:
                source_team_id = str(team["transfermarkt_team_id"])
                try:
                    payload = fetch_json(
                        api_url(f"transfer/history/club/{source_team_id}", [("season", str(start_year))]),
                        args.retries,
                        args.sleep,
                    )
                except TransfermarktNotFound:
                    return None
                return extract_api_departure_loans(payload, team, start_year)

            loan_stubs: list[dict[str, Any]] = []
            coverage: dict[tuple[str, int], int] = {}
            fetched_team_seasons: set[tuple[str, int]] = set()
            with ThreadPoolExecutor(max_workers=max(args.workers, 1)) as executor:
                pending = {
                    executor.submit(fetch_team_season, team, start_year): (team, start_year)
                    for team in resolved_teams for start_year in seasons
                }
                for future in as_completed(pending):
                    team, start_year = pending[future]
                    label = str(team["team_name"])
                    try:
                        loans = future.result()
                    except RuntimeError as exc:
                        failures.append({"team": f"{label} {start_year}", "error": str(exc)})
                        continue
                    if loans is None:
                        unsupported_team_seasons.append(f"{label} {start_year}/{start_year + 1}")
                        continue
                    loan_stubs.extend(loans)
                    coverage[(label, start_year)] = len(loans)
                    fetched_team_seasons.add((str(team["canonical_team_id"]), start_year))

            if failures and not args.allow_fetch_failures:
                details = "\n".join(f"- {item['team']}: {item['error']}" for item in failures)
                raise RuntimeError(f"failed to fetch {len(failures)} Transfermarkt club histories:\n{details}")
            if resolved_teams and not loan_stubs:
                raise RuntimeError("Transfermarkt returned zero loans across every requested club and season")

            players = fetch_entities(
                "players",
                (stub["source_player_id"] for stub in loan_stubs),
                args.retries,
                args.sleep,
                args.workers,
            )
            clubs = fetch_entities(
                "clubs",
                (stub["source_destination_team_id"] for stub in loan_stubs),
                args.retries,
                args.sleep,
                args.workers,
            )
            loans = enrich_loan_stubs(loan_stubs, players, clubs)

            team_rows = list(cur.execute("select id::text, name from core.teams").fetchall())
            player_rows = list(cur.execute("select id::text, display_name from core.players").fetchall())
            team_by_name = unique_name_index(team_rows, "name", "id")
            player_by_name = unique_player_name_index(player_rows)
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
                player_key = canonical_player_name(player_name)
                canonical_id = player_mapping.get(source_player_id) or player_by_name.get(player_key)
                metadata = {"formation_position": loan.get("formation_position"), "transfermarkt_loan_import": True}
                if canonical_id is None:
                    row = cur.execute(
                        "insert into core.players (display_name, display_name_he, primary_position, metadata) values (%s, %s, %s, %s) returning id::text",
                        (player_name, loan.get("player_name_he"), loan.get("primary_position"), json.dumps(metadata)),
                    ).fetchone()
                    canonical_id = str(row["id"])
                    player_by_name[player_key] = canonical_id
                else:
                    cur.execute(
                        """
                        update core.players
                        set display_name_he = coalesce(nullif(display_name_he, ''), %s),
                            primary_position = coalesce(primary_position, %s),
                            metadata = metadata || %s::jsonb
                        where id = %s
                        """,
                        (loan.get("player_name_he"), loan.get("primary_position"), json.dumps(metadata), canonical_id),
                    )
                upsert_mapping(cur, source_id, "player", source_player_id, "core.players", canonical_id, player_name)
                player_mapping[source_player_id] = canonical_id
                return canonical_id

            for start_year in seasons:
                cur.execute(
                    """
                    delete from obs.player_loans
                    where source_id = %s
                      and started_on >= make_date(%s, 7, 1)
                      and started_on < make_date(%s + 1, 7, 1)
                    """,
                    (source_id, start_year, start_year),
                )

            fetched_loans: dict[tuple[str, str, str, date], dict[str, Any]] = {}
            for loan in loans:
                key = (
                    str(loan["source_player_id"]),
                    str(loan["source_parent_team_id"]),
                    str(loan["source_destination_team_id"]),
                    loan["started_on"],
                )
                fetched_loans[key] = loan

            for loan in fetched_loans.values():
                player_id = ensure_player(loan)
                parent_team_id = ensure_team(str(loan["source_parent_team_id"]), str(loan["parent_team_name"]))
                destination_team_id = ensure_team(str(loan["source_destination_team_id"]), str(loan["destination_team_name"]))
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
                            "source_transfer_id": loan.get("source_transfer_id"),
                            "transfer_detail_url": loan["transfer_detail_url"],
                            "acquisition_method": "transfermarkt_internal_api",
                        }),
                    ),
                )
            connection.commit()

    print("Transfermarkt loan coverage:", flush=True)
    for (team_name, start_year), count in sorted(coverage.items(), key=lambda item: (item[0][1], item[0][0])):
        print(f"- {start_year}/{start_year + 1} {team_name}: {count}", flush=True)
    if unsupported_teams:
        print(
            f"Transfermarkt does not index {len(unsupported_teams)} candidate clubs: "
            + ", ".join(sorted(unsupported_teams)),
            flush=True,
        )
    if unsupported_team_seasons:
        print(
            f"Transfermarkt has no history for {len(unsupported_team_seasons)} club-seasons: "
            + ", ".join(sorted(unsupported_team_seasons)),
            flush=True,
        )
    if duplicate_candidate_teams:
        print(
            f"Collapsed {len(duplicate_candidate_teams)} duplicate canonical club aliases: "
            + ", ".join(sorted(duplicate_candidate_teams)),
            flush=True,
        )
    print(
        f"Transfermarkt loans synchronized automatically: {len(fetched_loans)} records from "
        f"{len(resolved_teams)} clubs across {len(seasons)} seasons"
        + (f" ({len(failures)} fetch failures allowed)" if failures else ""),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
