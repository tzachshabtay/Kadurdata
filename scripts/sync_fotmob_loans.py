#!/usr/bin/env python3
"""Synchronize current team rosters and explicit loans from FotMob team pages."""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

try:
    from scripts.ingest_fotmob import page_props
except ModuleNotFoundError:
    from ingest_fotmob import page_props


BASE_URL = "https://www.fotmob.com"
SEARCH_URL = f"{BASE_URL}/api/data/search/suggest"
USER_AGENT = "Mozilla/5.0 (compatible; Kadurdata/1.0; football roster import)"
FOTMOB_SOURCE = {
    "code": "fotmob",
    "name": "FotMob",
    "kind": "unofficial_web_page_data",
    "base_url": BASE_URL,
    "priority": 20,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synchronize FotMob team rosters and player loans into Supabase.")
    parser.add_argument("--lookback-years", type=int, default=2)
    parser.add_argument("--limit", type=int, default=0, help="Limit parent clubs for a smoke run.")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--sleep", type=float, default=0.15)
    parser.add_argument("--allow-fetch-failures", action="store_true")
    return parser.parse_args()


def fetch_text(url: str, retries: int, sleep_seconds: float) -> str:
    error: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json"})
            with urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8")
        except (HTTPError, URLError, TimeoutError) as exc:
            error = exc
            if attempt < retries:
                time.sleep(sleep_seconds * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {error}")


def normalized_name(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    ascii_value = ascii_value.replace("'", "")
    ascii_value = re.sub(r"\b(?:fc|football club)\b", " ", ascii_value.lower())
    return re.sub(r"[^a-z0-9]+", " ", ascii_value).strip()


def slugify(value: str) -> str:
    return normalized_name(value).replace(" ", "-") or "team"


def search_suggestions(payload: Any, entity_type: str) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        return []
    suggestions: dict[str, dict[str, Any]] = {}
    for group in payload:
        if not isinstance(group, dict):
            continue
        for item in group.get("suggestions") or []:
            if item.get("type") == entity_type and item.get("id") is not None:
                suggestions[str(item["id"])] = item
    return list(suggestions.values())


def select_team_suggestion(suggestions: list[dict[str, Any]], team_name: str) -> Optional[dict[str, Any]]:
    wanted = normalized_name(team_name)
    exact = [item for item in suggestions if normalized_name(str(item.get("name") or "")) == wanted]
    if len(exact) == 1:
        return exact[0]
    if len(suggestions) == 1:
        return suggestions[0]
    return max(suggestions, key=lambda item: int(item.get("score") or 0), default=None)


def resolve_fotmob_team(team_name: str, retries: int, sleep_seconds: float) -> Optional[dict[str, Any]]:
    payload = json.loads(fetch_text(f"{SEARCH_URL}?term={quote(team_name)}", retries, sleep_seconds))
    return select_team_suggestion(search_suggestions(payload, "team"), team_name)


def transfer_date(value: Any) -> Optional[date]:
    text = str(value or "")[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def source_team_key(source_team_id: Any, team_name: str) -> str:
    raw = str(source_team_id or "").strip()
    return raw if raw and raw != "-1" else f"name:{normalized_name(team_name)}"


def primary_position(transfer: dict[str, Any]) -> Optional[str]:
    position = transfer.get("position") or {}
    value = f"{position.get('key') or ''} {position.get('label') or ''}".lower()
    if "keeper" in value or "gk" in value:
        return "Goalkeeper"
    if any(token in value for token in ("back", "defender")) or re.search(r"\b(?:cb|lb|rb|lwb|rwb)\b", value):
        return "Defender"
    if "midfield" in value or re.search(r"\b(?:dm|cm|am|cdm|cam|lm|rm)\b", value):
        return "Midfielder"
    if any(token in value for token in ("winger", "striker", "forward")) or re.search(r"\b(?:st|cf|lw|rw)\b", value):
        return "Attacker"
    return None


def formation_position(transfer: dict[str, Any]) -> Optional[str]:
    label = str((transfer.get("position") or {}).get("label") or "").strip()
    return label or None


def roster_primary_position(group_name: str) -> Optional[str]:
    return {
        "keepers": "Goalkeeper",
        "defenders": "Defender",
        "midfielders": "Midfielder",
        "attackers": "Attacker",
        "coach": "Management",
        "management": "Management",
        "staff": "Management",
    }.get(group_name.lower())


def extract_team_roster(team_payload: dict[str, Any], fetched_team_id: str) -> tuple[str, list[dict[str, Any]]]:
    season_name = str((team_payload.get("overview") or {}).get("season") or "").strip()
    groups = (team_payload.get("squad") or {}).get("squad") or []
    roster: list[dict[str, Any]] = []
    if not season_name:
        return season_name, roster
    for group in groups:
        group_name = str(group.get("title") or "other").strip().lower()
        for member in group.get("members") or []:
            if member.get("id") is None or not str(member.get("name") or "").strip():
                continue
            role = member.get("role") or {}
            positions = [value.strip() for value in str(member.get("positionIdsDesc") or "").split(",") if value.strip()]
            roster.append({
                "source_player_id": str(member["id"]),
                "player_name": str(member["name"]).strip(),
                "source_team_id": fetched_team_id,
                "season_name": season_name,
                "roster_group": group_name,
                "role_name": str(role.get("fallback") or role.get("key") or group_name).strip(),
                "primary_position": roster_primary_position(group_name),
                "formation_position": positions[0] if positions else None,
                "shirt_number": member.get("shirtNumber"),
                "metadata": {
                    "position_ids": member.get("positionIds"),
                    "position_codes": positions,
                    "height": member.get("height"),
                    "date_of_birth": member.get("dateOfBirth"),
                    "country_code": member.get("ccode"),
                    "country_name": member.get("cname"),
                    "transfer_value": member.get("transferValue"),
                },
            })
    return season_name, roster


def extract_team_loans(team_payload: dict[str, Any], fetched_team_id: str) -> list[dict[str, Any]]:
    transfers = (team_payload.get("transfers") or {}).get("allTransfers") or []
    loans: list[dict[str, Any]] = []
    for transfer in transfers:
        if not transfer.get("onLoan") or transfer.get("playerId") is None:
            continue
        from_name = str(transfer.get("fromClubFullName") or transfer.get("fromClub") or "").strip()
        to_name = str(transfer.get("toClubFullName") or transfer.get("toClub") or "").strip()
        if not from_name or not to_name:
            continue
        transfer_happened_on = transfer_date(transfer.get("transferDate"))
        started_on = transfer_date(transfer.get("fromDate")) or transfer_happened_on
        if started_on is None:
            continue
        loans.append({
            "source_player_id": str(transfer["playerId"]),
            "player_name": str(transfer.get("name") or "Unknown player").strip(),
            "source_parent_team_id": source_team_key(transfer.get("fromClubId"), from_name),
            "parent_team_name": from_name,
            "source_destination_team_id": source_team_key(transfer.get("toClubId"), to_name),
            "destination_team_name": to_name,
            "started_on": started_on,
            "ended_on": transfer_date(transfer.get("toDate")),
            "primary_position": primary_position(transfer),
            "formation_position": formation_position(transfer),
            "fetched_team_id": fetched_team_id,
            "transfer_date": transfer_happened_on,
        })
    return loans


def candidate_teams(cur: Any, fotmob_source_id: str, lookback_years: int) -> list[dict[str, Any]]:
    return list(cur.execute(
        """
        with relevant_team_ids as (
          select match.home_team_id as team_id
          from core.matches match
          join core.seasons season on season.id = match.season_id
          join core.competitions competition on competition.id = season.competition_id
          join core.countries country on country.id = competition.country_id
          where coalesce(competition.metadata ->> 'scope', 'domestic') = 'domestic'
            and lower(country.name) = 'israel'
            and competition.gender = 'men'
            and coalesce(competition.metadata ->> 'age_group', 'senior') = 'senior'
            and coalesce(competition.metadata ->> 'participant_type', 'club') = 'club'
            and coalesce(season.end_date, season.start_date, match.scheduled_at::date, current_date)
              >= current_date - make_interval(years => %s)

          union

          select match.away_team_id as team_id
          from core.matches match
          join core.seasons season on season.id = match.season_id
          join core.competitions competition on competition.id = season.competition_id
          join core.countries country on country.id = competition.country_id
          where coalesce(competition.metadata ->> 'scope', 'domestic') = 'domestic'
            and lower(country.name) = 'israel'
            and competition.gender = 'men'
            and coalesce(competition.metadata ->> 'age_group', 'senior') = 'senior'
            and coalesce(competition.metadata ->> 'participant_type', 'club') = 'club'
            and coalesce(season.end_date, season.start_date, match.scheduled_at::date, current_date)
              >= current_date - make_interval(years => %s)
        )
        select distinct
          team.id::text as canonical_team_id,
          team.name as team_name,
          mapping.source_entity_id as fotmob_team_id
        from relevant_team_ids relevant
        join core.teams team on team.id = relevant.team_id
        left join source.source_entity_ids mapping
          on mapping.source_id = %s
         and mapping.entity_type = 'team'
         and mapping.canonical_id = team.id
        order by team.name
        """,
        (max(lookback_years, 0), max(lookback_years, 0), fotmob_source_id),
    ).fetchall())


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
        tuple(FOTMOB_SOURCE[key] for key in ("code", "name", "kind", "base_url", "priority")),
    ).fetchone()
    return str(row["id"])


def upsert_mapping(
    cur: Any,
    source_id: str,
    entity_type: str,
    source_entity_id: str,
    canonical_table: str,
    canonical_id: str,
    source_name: str,
) -> None:
    cur.execute(
        """
        insert into source.source_entity_ids as mapping (
          source_id, entity_type, source_entity_id, canonical_table, canonical_id,
          source_name, confidence, mapping_status
        )
        values (%s, %s, %s, %s, %s, %s, 1, 'auto')
        on conflict (source_id, entity_type, source_entity_id) do update
          set canonical_table = excluded.canonical_table,
              canonical_id = coalesce(mapping.canonical_id, excluded.canonical_id),
              source_name = excluded.source_name,
              last_seen_at = now()
        """,
        (source_id, entity_type, source_entity_id, canonical_table, canonical_id, source_name),
    )


def unique_name_index(rows: list[dict[str, Any]], name_key: str, id_key: str) -> dict[str, Optional[str]]:
    grouped: dict[str, list[str]] = {}
    for row in rows:
        grouped.setdefault(normalized_name(str(row[name_key])), []).append(str(row[id_key]))
    return {name: ids[0] if len(set(ids)) == 1 else None for name, ids in grouped.items()}


def main() -> int:
    import psycopg
    from psycopg.rows import dict_row

    args = parse_args()
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    with psycopg.connect(database_url, row_factory=dict_row, prepare_threshold=None) as connection:
        with connection.cursor() as cur:
            fotmob_source_id = get_source(cur)
            teams = candidate_teams(cur, fotmob_source_id, args.lookback_years)
            if args.limit > 0:
                teams = teams[:args.limit]

            resolved_teams: list[dict[str, Any]] = []
            failures: list[dict[str, str]] = []
            for team in teams:
                source_team_id = str(team.get("fotmob_team_id") or "")
                if not source_team_id:
                    try:
                        suggestion = resolve_fotmob_team(str(team["team_name"]), args.retries, args.sleep)
                    except RuntimeError as exc:
                        suggestion = None
                        failures.append({"team": str(team["team_name"]), "error": str(exc)})
                    if not suggestion:
                        continue
                    source_team_id = str(suggestion["id"])
                upsert_mapping(
                    cur,
                    fotmob_source_id,
                    "team",
                    source_team_id,
                    "core.teams",
                    str(team["canonical_team_id"]),
                    str(team["team_name"]),
                )
                resolved_teams.append({**team, "fotmob_team_id": source_team_id})
            connection.commit()

            def fetch_team(team: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], str, list[dict[str, Any]]]:
                source_team_id = str(team["fotmob_team_id"])
                url = f"{BASE_URL}/teams/{quote(source_team_id)}/overview/{quote(slugify(str(team['team_name'])))}"
                props = page_props(fetch_text(url, args.retries, args.sleep))
                payload = (props.get("fallback") or {}).get(f"team-{source_team_id}")
                if not isinstance(payload, dict):
                    raise RuntimeError(f"FotMob team page had no team-{source_team_id} payload")
                season_name, roster = extract_team_roster(payload, source_team_id)
                return team, extract_team_loans(payload, source_team_id), season_name, roster

            fetched_loans: dict[tuple[str, str, str, Optional[date]], dict[str, Any]] = {}
            fetched_rosters: dict[tuple[str, str, str], dict[str, Any]] = {}
            fetched_roster_teams: set[tuple[str, str]] = set()
            with ThreadPoolExecutor(max_workers=max(args.workers, 1)) as executor:
                pending = {executor.submit(fetch_team, team): team for team in resolved_teams}
                for future in as_completed(pending):
                    team = pending[future]
                    try:
                        _, loans, roster_season_name, roster = future.result()
                    except RuntimeError as exc:
                        failures.append({"team": str(team["team_name"]), "error": str(exc)})
                        continue
                    for loan in loans:
                        key = (
                            loan["source_player_id"],
                            loan["source_parent_team_id"],
                            loan["source_destination_team_id"],
                            loan["started_on"],
                        )
                        fetched_loans[key] = loan
                    if roster_season_name:
                        source_team_id = str(team["fotmob_team_id"])
                        fetched_roster_teams.add((source_team_id, roster_season_name))
                        for member in roster:
                            fetched_rosters[(source_team_id, member["source_player_id"], roster_season_name)] = {
                                **member,
                                "canonical_team_id": str(team["canonical_team_id"]),
                            }

            if failures and not args.allow_fetch_failures:
                details = "\n".join(f"- {item['team']}: {item['error']}" for item in failures)
                raise RuntimeError(f"failed to resolve or fetch {len(failures)} teams:\n{details}")

            team_rows = list(cur.execute("select id::text, name from core.teams").fetchall())
            player_rows = list(cur.execute("select id::text, display_name from core.players").fetchall())
            team_by_name = unique_name_index(team_rows, "name", "id")
            player_by_name = unique_name_index(player_rows, "display_name", "id")
            team_mapping = {
                str(row["source_entity_id"]): str(row["canonical_id"])
                for row in cur.execute(
                    """
                    select source_entity_id, canonical_id
                    from source.source_entity_ids
                    where source_id = %s and entity_type = 'team' and canonical_id is not null
                    """,
                    (fotmob_source_id,),
                ).fetchall()
            }
            player_mapping = {
                str(row["source_entity_id"]): str(row["canonical_id"])
                for row in cur.execute(
                    """
                    select source_entity_id, canonical_id
                    from source.source_entity_ids
                    where source_id = %s and entity_type = 'player' and canonical_id is not null
                    """,
                    (fotmob_source_id,),
                ).fetchall()
            }

            def ensure_team(source_team_id: str, team_name: str) -> Optional[str]:
                canonical_id = team_mapping.get(source_team_id) or team_by_name.get(normalized_name(team_name))
                if canonical_id is None and not source_team_id.startswith("name:"):
                    row = cur.execute(
                        "insert into core.teams (name) values (%s) returning id::text",
                        (team_name,),
                    ).fetchone()
                    canonical_id = str(row["id"])
                    team_by_name[normalized_name(team_name)] = canonical_id
                if canonical_id and not source_team_id.startswith("name:"):
                    upsert_mapping(cur, fotmob_source_id, "team", source_team_id, "core.teams", canonical_id, team_name)
                    team_mapping[source_team_id] = canonical_id
                return canonical_id

            def ensure_player(player_data: dict[str, Any], import_kind: str) -> str:
                source_player_id = str(player_data["source_player_id"])
                player_name = str(player_data["player_name"])
                canonical_id = player_mapping.get(source_player_id) or player_by_name.get(normalized_name(player_name))
                metadata = {
                    "formation_position": player_data.get("formation_position"),
                    f"fotmob_{import_kind}_import": True,
                    **(player_data.get("metadata") or {}),
                }
                if canonical_id is None:
                    row = cur.execute(
                        """
                        insert into core.players (display_name, primary_position, metadata)
                        values (%s, %s, %s)
                        returning id::text
                        """,
                        (player_name, player_data.get("primary_position"), json.dumps(metadata)),
                    ).fetchone()
                    canonical_id = str(row["id"])
                    player_by_name[normalized_name(player_name)] = canonical_id
                else:
                    cur.execute(
                        """
                        update core.players
                        set primary_position = coalesce(primary_position, %s),
                            metadata = metadata || %s::jsonb
                        where id = %s
                        """,
                        (player_data.get("primary_position"), json.dumps(metadata), canonical_id),
                    )
                upsert_mapping(cur, fotmob_source_id, "player", source_player_id, "core.players", canonical_id, player_name)
                player_mapping[source_player_id] = canonical_id
                return canonical_id

            for loan in fetched_loans.values():
                player_id = ensure_player(loan, "loan")
                parent_team_id = ensure_team(loan["source_parent_team_id"], loan["parent_team_name"])
                destination_team_id = ensure_team(loan["source_destination_team_id"], loan["destination_team_name"])
                cur.execute(
                    """
                    insert into obs.player_loans as existing (
                      source_id,
                      player_id,
                      parent_team_id,
                      destination_team_id,
                      source_player_id,
                      source_parent_team_id,
                      source_destination_team_id,
                      parent_team_name,
                      destination_team_name,
                      started_on,
                      ended_on,
                      observed_at,
                      metadata
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), %s)
                    on conflict (
                      source_id,
                      source_player_id,
                      source_parent_team_id,
                      source_destination_team_id,
                      started_on
                    ) do update
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
                        fotmob_source_id,
                        player_id,
                        parent_team_id,
                        destination_team_id,
                        loan["source_player_id"],
                        loan["source_parent_team_id"],
                        loan["source_destination_team_id"],
                        loan["parent_team_name"],
                        loan["destination_team_name"],
                        loan["started_on"],
                        loan["ended_on"],
                        json.dumps({
                            "fetched_team_id": loan["fetched_team_id"],
                            "transfer_date": loan["transfer_date"].isoformat() if loan["transfer_date"] else None,
                            "formation_position": loan.get("formation_position"),
                        }),
                    ),
                )

            for source_team_id, _ in fetched_roster_teams:
                cur.execute(
                    """
                    update obs.team_roster_memberships
                    set is_active = false,
                        observed_at = now()
                    where source_id = %s
                      and source_team_id = %s
                    """,
                    (fotmob_source_id, source_team_id),
                )

            for roster in fetched_rosters.values():
                player_id = ensure_player(roster, "roster")
                cur.execute(
                    """
                    insert into obs.team_roster_memberships as existing (
                      source_id,
                      team_id,
                      player_id,
                      source_team_id,
                      source_player_id,
                      season_name,
                      roster_group,
                      role_name,
                      specific_position,
                      shirt_number,
                      is_active,
                      observed_at,
                      metadata
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true, now(), %s)
                    on conflict (source_id, source_team_id, source_player_id, season_name) do update
                      set team_id = excluded.team_id,
                          player_id = excluded.player_id,
                          roster_group = excluded.roster_group,
                          role_name = excluded.role_name,
                          specific_position = excluded.specific_position,
                          shirt_number = excluded.shirt_number,
                          is_active = true,
                          observed_at = now(),
                          metadata = excluded.metadata
                    """,
                    (
                        fotmob_source_id,
                        roster["canonical_team_id"],
                        player_id,
                        roster["source_team_id"],
                        roster["source_player_id"],
                        roster["season_name"],
                        roster["roster_group"],
                        roster["role_name"],
                        roster.get("formation_position"),
                        roster.get("shirt_number"),
                        json.dumps(roster.get("metadata") or {}),
                    ),
                )
            connection.commit()

    print(
        f"FotMob synchronized: {len(fetched_rosters)} roster members and {len(fetched_loans)} loans "
        f"from {len(resolved_teams)} clubs"
        + (f" ({len(failures)} fetch failures allowed)" if failures else ""),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
