"""Parse native 365Scores team-stat values independently of comparison shares."""

from __future__ import annotations

import re
from typing import Optional


PERCENTAGE_VALUE = re.compile(r"^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%$")


def parse_team_stat_value(value: str, value_percentage: str) -> tuple[Optional[float], str]:
    raw = value or value_percentage
    if value:
        text = value.strip().replace("%", "")
        if "/" in text:
            text = text.split("/", 1)[0].strip()
        try:
            return float(text), raw
        except ValueError:
            pass
    if value_percentage:
        try:
            return float(value_percentage) * 100, raw
        except ValueError:
            pass
    return None, raw


def team_stat_value_type(value: str) -> str:
    return "percentage" if PERCENTAGE_VALUE.fullmatch(value.strip()) else "count"
