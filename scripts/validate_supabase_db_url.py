#!/usr/bin/env python3
"""Validate the Supabase database URL shape without printing secrets."""

from __future__ import annotations

import os
from urllib.parse import urlparse


EXPECTED_HOST = "aws-0-ca-central-1.pooler.supabase.com"
EXPECTED_USER = "postgres.zmmubdmuqwpihyptlxrg"
EXPECTED_DATABASE = "postgres"


def main() -> int:
    database_url = os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    parsed = urlparse(database_url)
    errors = []

    if parsed.scheme not in {"postgresql", "postgres"}:
        errors.append("scheme must be postgresql://")
    if parsed.username != EXPECTED_USER:
        errors.append(f"username must be {EXPECTED_USER!r}, got {parsed.username!r}")
    if parsed.hostname != EXPECTED_HOST:
        errors.append(f"host must be {EXPECTED_HOST!r}, got {parsed.hostname!r}")
    if parsed.port != 5432:
        errors.append(f"port must be 5432, got {parsed.port!r}")
    if parsed.path.lstrip("/") != EXPECTED_DATABASE:
        errors.append(f"database path must be /{EXPECTED_DATABASE}, got {parsed.path!r}")
    if not parsed.password:
        errors.append("password is missing")

    if errors:
        raise SystemExit("Invalid SUPABASE_DB_URL:\n- " + "\n- ".join(errors))

    print(
        "SUPABASE_DB_URL shape OK: "
        f"user={parsed.username}, host={parsed.hostname}, port={parsed.port}, database={parsed.path.lstrip('/')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
