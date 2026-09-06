import unittest

from scripts.player_identity import (
    canonical_player_name,
    preferred_player_name_index,
    resolve_preferred_player_id,
)


class PlayerIdentityTests(unittest.TestCase):
    def test_reconciles_vetted_full_name_aliases(self) -> None:
        aliases = {
            "Noam Muche": "noam mucha",
            "Roey Elimelech": "roei elimelech",
            "Yan Shikut": "yan shickut",
            "Ahmad Hamam": "ahmad haman",
            "Waheb Habiballah": "wahib habiballah",
            "William Agada": "willy agada",
            "Jwan Al Halabi": "gwan halabi",
            "Ido Vaier": "ido vayer",
            "Itzik Shoolmayster": "itzik shulmeister",
            "Nadav Markovitch": "nadav markovich",
            "Niv Michael Gabay": "niv gabay",
            "Obeida Darwish": "ovadia darwish",
            "Shon Edri": "sean edri",
            "Ilay Madmon": "elay madmon",
            "Israel Dapaah": "israel dappa",
            "Lion Mizrachi": "li on mizrahi",
            "Nadeem Warasneh": "nadim vrasana",
            "Netanel Shiferaw": "netanel shprao",
            "Omer Agvadish": "omer agbadish",
            "Yanai Distelfeld": "yanai distalfeld",
            "Sharani Zuberu": "zuberu sharani",
            "Alex Moucketou-Moussounda": "alex moussounda",
            "Itay Ehud-Zaira": "itay ehud",
            "Yazen Nassar": "yazan nassar",
            "Roei Alkukin": "roi alkukin",
            "Daniel Dzhulani": "daniel golani",
            "Daniel Joulani": "daniel golani",
            "Nehoray Hen": "nehoray chen",
            "Qayes Ghanem": "qays ghanem",
            "Ali Muhammad": "ali mohamed",
            "Cédric Don": "don cedric",
            "Ethane Azoulay": "eitan azulay",
            "Zohar Zasano": "zohar zasno",
            "Aziz Ouattara": "aziz outtara",
            "Nadav Niddam": "nadav nidam",
            "Ariel Lugassy": "ariel lugasi",
            "Bashar Abdach": "bashar ibdah",
            "Eyal Einbrom": "eyal inburum",
            "Guy Deznet": "guy dezent",
            "Pavlos Korrea": "pavlos correa",
            "Elai Ben Simon": "elay ben simon",
            "Mohamed Ali Camara": "mohamed ali kamara",
            "Roi Mishpati": "roei mashpati",
            "Gontie Junior Diomandé": "gontie diomande",
            "Ravid Olezki": "ravid ulitsky",
            "Sarel Cohen": "sarel shlomo cohen",
            "Ilay Tzairi": "illay tzeiri",
            "Roy Baranes": "roy hen baranes",
            "Roy Navi": "roy nawi",
            "Mahmoud Jaber": "mahmud jaber",
        }
        for alias, expected in aliases.items():
            with self.subTest(alias=alias):
                self.assertEqual(canonical_player_name(alias), expected)

    def test_does_not_collapse_ambiguous_short_or_cohen_names(self) -> None:
        for player_name in ("Daniel", "Cle", "Falcao", "Ari Cohen", "Ariel Cohen"):
            with self.subTest(player_name=player_name):
                self.assertEqual(canonical_player_name(player_name), player_name.lower())

    def test_prefers_unique_canonical_spelling_within_alias_family(self) -> None:
        index = preferred_player_name_index([
            {"id": "season-player", "display_name": "Mohamed Ali Kamara"},
            {"id": "roster-player", "display_name": "Mohamed Ali Camara"},
        ])

        self.assertEqual(index["mohamed ali kamara"], "season-player")

    def test_stale_mapping_resolves_to_unique_preferred_alias_candidate(self) -> None:
        index = preferred_player_name_index([
            {"id": "season-player", "display_name": "Roei Mashpati"},
            {"id": "roster-player", "display_name": "Roi Mishpati"},
        ])

        player_id, should_repair = resolve_preferred_player_id(
            "fotmob-player",
            "Roi Mishpati",
            {"fotmob-player": "roster-player"},
            index,
            {
                "season-player": "Roei Mashpati",
                "roster-player": "Roi Mishpati",
            },
        )

        self.assertEqual(player_id, "season-player")
        self.assertTrue(should_repair)

    def test_ambiguous_canonical_spelling_keeps_existing_mapping(self) -> None:
        index = preferred_player_name_index([
            {"id": "first", "display_name": "John Smith"},
            {"id": "second", "display_name": "John Smith"},
        ])

        player_id, should_repair = resolve_preferred_player_id(
            "source-player",
            "John Smith",
            {"source-player": "second"},
            index,
            {"first": "John Smith", "second": "John Smith"},
        )

        self.assertEqual(player_id, "second")
        self.assertFalse(should_repair)

    def test_unmapped_source_id_uses_unique_preferred_alias_candidate(self) -> None:
        index = preferred_player_name_index([
            {"id": "season-player", "display_name": "Elay Ben Simon"},
            {"id": "roster-player", "display_name": "Elai Ben Simon"},
        ])

        player_id, should_repair = resolve_preferred_player_id(
            "new-provider-player",
            "Elai Ben Simon",
            {},
            index,
            {
                "season-player": "Elay Ben Simon",
                "roster-player": "Elai Ben Simon",
            },
        )

        self.assertEqual(player_id, "season-player")
        self.assertFalse(should_repair)

    def test_changed_provider_name_cannot_replace_unrelated_existing_mapping(self) -> None:
        index = preferred_player_name_index([
            {"id": "mapped-player", "display_name": "Existing Player"},
            {"id": "incoming-player", "display_name": "Unique Incoming Player"},
        ])

        player_id, should_repair = resolve_preferred_player_id(
            "reused-provider-id",
            "Unique Incoming Player",
            {"reused-provider-id": "mapped-player"},
            index,
            {
                "mapped-player": "Existing Player",
                "incoming-player": "Unique Incoming Player",
            },
        )

        self.assertEqual(player_id, "mapped-player")
        self.assertFalse(should_repair)


if __name__ == "__main__":
    unittest.main()
