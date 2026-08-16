"""Normalize source-specific player statistic sentinel values."""

from __future__ import annotations

from typing import Any, Optional


def rating_value(value: Any) -> Optional[float]:
    if value is None or str(value).strip() == "":
        return None
    numeric = float(value)
    return numeric if numeric >= 0 else None
