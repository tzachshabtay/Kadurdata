"""Conservative cross-source normalization for football player identities."""

from __future__ import annotations

import re
import unicodedata


PLAYER_NAME_ALIASES = {
    "awaka eshata": "awka ashta",
    "gabi kanichowsky": "gabi kanikovski",
    "hasan hilu": "hassan hilo",
    "idan toklomati": "idan toklomaty",
    "itay zafrani": "itai zafrani",
    "mahmud jaber": "mahmoud jaber",
    "roy nawi": "roy navi",
    "tay abed": "tai abed",
}


def normalized_player_name(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    ascii_value = ascii_value.replace("'", "")
    return re.sub(r"[^a-z0-9]+", " ", ascii_value.lower()).strip()


def canonical_player_name(value: str) -> str:
    normalized = normalized_player_name(value)
    return PLAYER_NAME_ALIASES.get(normalized, normalized)
