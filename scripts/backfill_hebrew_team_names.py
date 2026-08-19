#!/usr/bin/env python3
"""Populate Hebrew team names from 365Scores source identities."""

from __future__ import annotations

import argparse
import json
import os
import re
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
HEBREW_PATTERN = re.compile(r"[\u0590-\u05ff]")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fill missing core.teams.name_he values from 365Scores."
    )
    parser.add_argument("--batch-size", type=int, default=50)
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
        help="Continue when a competitor batch cannot be fetched after all retries.",
    )
    return parser.parse_args()


def chunked(values: list[str], size: int) -> Iterator[list[str]]:
    if size < 1:
        raise ValueError("batch size must be at least 1")
    for index in range(0, len(values), size):
        yield values[index : index + size]


def competitors_url(competitor_ids: Iterable[str]) -> str:
    params = {
        "appTypeId": 5,
        "langId": 2,
        "timezoneName": "Asia/Jerusalem",
        "userCountryId": 6,
        "competitors": ",".join(competitor_ids),
    }
    return f"{BASE_URL}/web/competitors/?{urlencode(params)}"


def fetch_json(url: str, *, retries: int, sleep_seconds: float) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if sleep_seconds > 0:
                time.sleep(sleep_seconds)
            return payload
        except (HTTPError, URLError, TimeoutError, socket.timeout, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(sleep_seconds * (attempt + 1))
    raise RuntimeError(f"failed to fetch Hebrew competitor names: {last_error}")


def extract_hebrew_competitors(payload: dict[str, Any]) -> dict[str, str]:
    names: dict[str, str] = {}
    for competitor in payload.get("competitors") or []:
        competitor_id = competitor.get("id")
        name = str(competitor.get("longName") or competitor.get("name") or "").strip()
        if competitor_id is not None and name and HEBREW_PATTERN.search(name):
            names[str(competitor_id)] = name
    return names


def team_mappings(cur: psycopg.Cursor, *, refresh: bool) -> dict[str, str]:
    cur.execute(
        """
        select distinct
          mapping.source_entity_id,
          mapping.canonical_id::text as team_id
        from source.source_entity_ids mapping
        join source.sources source on source.id = mapping.source_id
        join core.teams team on team.id = mapping.canonical_id
        where source.code = %s
          and mapping.entity_type = 'team'
          and mapping.canonical_id is not null
          and (%s or nullif(btrim(team.name_he), '') is null)
        order by mapping.source_entity_id
        """,
        (SOURCE_CODE, refresh),
    )
    return {
        str(row["source_entity_id"]): str(row["team_id"])
        for row in cur.fetchall()
        if str(row["source_entity_id"]).isdigit()
    }


def update_teams(
    cur: psycopg.Cursor,
    mappings: dict[str, str],
    names_by_source_id: dict[str, str],
    *,
    refresh: bool,
) -> int:
    updated = 0
    for source_team_id, hebrew_name in names_by_source_id.items():
        team_id = mappings.get(source_team_id)
        if not team_id:
            continue
        cur.execute(
            """
            update core.teams
            set name_he = %s
            where id = %s::uuid
              and (%s or nullif(btrim(name_he), '') is null)
            """,
            (hebrew_name, team_id, refresh),
        )
        updated += cur.rowcount
    return updated


def main() -> int:
    args = parse_args()
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be at least 1")
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(database_url, row_factory=dict_row, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            mappings = team_mappings(cur, refresh=args.refresh)
            batches = list(chunked(sorted(mappings), args.batch_size))
            names_by_source_id: dict[str, str] = {}
            failed_batches = 0

            with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
                futures = {
                    executor.submit(
                        fetch_json,
                        competitors_url(batch),
                        retries=args.retries,
                        sleep_seconds=args.sleep,
                    ): batch
                    for batch in batches
                }
                for future in as_completed(futures):
                    try:
                        names_by_source_id.update(extract_hebrew_competitors(future.result()))
                    except RuntimeError as exc:
                        failed_batches += 1
                        if not args.allow_fetch_failures:
                            raise
                        print(f"warning: {exc}")

            updated = update_teams(
                cur,
                mappings,
                names_by_source_id,
                refresh=args.refresh,
            )
            conn.commit()

    print(
        "Hebrew team names: "
        f"database_candidates={len(mappings)}, source_returned={len(names_by_source_id)}, "
        f"updated={updated}, unresolved={len(mappings) - len(names_by_source_id)}, "
        f"failed_batches={failed_batches}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
