"""Conservative cross-source normalization for football player identities."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping
from typing import Optional


PLAYER_NAME_ALIASES = {
    "ahmad hamam": "ahmad haman",
    "alex moucketou moussounda": "alex moussounda",
    "ali muhammad": "ali mohamed",
    "ariel lugassy": "ariel lugasi",
    "awaka eshata": "awka ashta",
    "aziz ouattara": "aziz outtara",
    "bashar abdach": "bashar ibdah",
    "cedric don": "don cedric",
    "daniel dzhulani": "daniel golani",
    "daniel joulani": "daniel golani",
    "elai ben simon": "elay ben simon",
    "ethane azoulay": "eitan azulay",
    "eyal einbrom": "eyal inburum",
    "gabi kanichowsky": "gabi kanikovski",
    "gontie junior diomande": "gontie diomande",
    "guy deznet": "guy dezent",
    "hasan hilu": "hassan hilo",
    "ido vaier": "ido vayer",
    "idan toklomati": "idan toklomaty",
    "ilay madmon": "elay madmon",
    "ilay tzairi": "illay tzeiri",
    "israel dapaah": "israel dappa",
    "itay zafrani": "itai zafrani",
    "itay ehud zaira": "itay ehud",
    "itzik shoolmayster": "itzik shulmeister",
    "jwan al halabi": "gwan halabi",
    "lion mizrachi": "li on mizrahi",
    "mahmoud jaber": "mahmud jaber",
    "mohamed ali camara": "mohamed ali kamara",
    "nadav markovitch": "nadav markovich",
    "nadav niddam": "nadav nidam",
    "nadeem warasneh": "nadim vrasana",
    "nehoray hen": "nehoray chen",
    "netanel shiferaw": "netanel shprao",
    "niv michael gabay": "niv gabay",
    "noam muche": "noam mucha",
    "obeida darwish": "ovadia darwish",
    "omer agvadish": "omer agbadish",
    "pavlos korrea": "pavlos correa",
    "qayes ghanem": "qays ghanem",
    "ravid olezki": "ravid ulitsky",
    "roei alkukin": "roi alkukin",
    "roey elimelech": "roei elimelech",
    "roi mishpati": "roei mashpati",
    "roy baranes": "roy hen baranes",
    "roy navi": "roy nawi",
    "sarel cohen": "sarel shlomo cohen",
    "sharani zuberu": "zuberu sharani",
    "shon edri": "sean edri",
    "tay abed": "tai abed",
    "waheb habiballah": "wahib habiballah",
    "william agada": "willy agada",
    "yan shikut": "yan shickut",
    "yanai distelfeld": "yanai distalfeld",
    "yazen nassar": "yazan nassar",
    "zohar zasano": "zohar zasno",
}


def normalized_player_name(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    ascii_value = ascii_value.replace("'", "")
    return re.sub(r"[^a-z0-9]+", " ", ascii_value.lower()).strip()


def canonical_player_name(value: str) -> str:
    normalized = normalized_player_name(value)
    return PLAYER_NAME_ALIASES.get(normalized, normalized)


def preferred_player_name_index(
    rows: Iterable[Mapping[str, object]],
    name_key: str = "display_name",
    id_key: str = "id",
) -> dict[str, Optional[str]]:
    """Index identities, preferring one exact canonical spelling over known aliases."""
    grouped: dict[str, dict[str, bool]] = {}
    for row in rows:
        player_name = str(row[name_key])
        player_id = str(row[id_key])
        normalized_name = normalized_player_name(player_name)
        canonical_name = canonical_player_name(player_name)
        if not canonical_name:
            continue
        candidates = grouped.setdefault(canonical_name, {})
        candidates[player_id] = candidates.get(player_id, False) or normalized_name == canonical_name

    index: dict[str, Optional[str]] = {}
    for canonical_name, candidates in grouped.items():
        preferred_ids = [player_id for player_id, is_preferred in candidates.items() if is_preferred]
        if len(preferred_ids) == 1:
            index[canonical_name] = preferred_ids[0]
        elif len(candidates) == 1:
            index[canonical_name] = next(iter(candidates))
        else:
            index[canonical_name] = None
    return index


def resolve_preferred_player_id(
    source_player_id: str,
    player_name: str,
    player_mapping: Mapping[str, str],
    player_by_name: Mapping[str, Optional[str]],
    player_name_by_id: Mapping[str, str],
) -> tuple[Optional[str], bool]:
    """Resolve a player and flag a stale source mapping that can be repaired safely."""
    mapped_id = player_mapping.get(source_player_id)
    preferred_id = player_by_name.get(canonical_player_name(player_name))
    if mapped_id:
        mapped_player_name = player_name_by_id.get(mapped_id)
        same_identity_family = bool(
            mapped_player_name
            and canonical_player_name(mapped_player_name) == canonical_player_name(player_name)
        )
        should_repair_mapping = bool(preferred_id and mapped_id != preferred_id and same_identity_family)
        return (preferred_id if should_repair_mapping else mapped_id), should_repair_mapping
    return preferred_id, False
