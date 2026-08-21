import unittest
from unittest.mock import patch

from scripts.backfill_hebrew_player_names import (
    athletes_url,
    chunked,
    clean_hebrew_name,
    extract_game_hebrew_names,
    extract_hebrew_names,
    extract_transliterated_name,
    game_url,
    is_365scores_athlete_id,
    search_url,
    select_transfermarkt_player,
    transliterate_israeli_players,
    transliteration_url,
)


class HebrewPlayerNameTests(unittest.TestCase):
    def test_removes_non_hebrew_suffixes_and_prefixes(self) -> None:
        self.assertEqual(clean_hebrew_name("עדן קארצב , Карцев Эден Вадимович"), "עדן קארצב")
        self.assertEqual(clean_hebrew_name("דיא סבע ‎ضياء سبع"), "דיא סבע")
        self.assertEqual(clean_hebrew_name("Шевяков Даниил, דניאל שביאקוב"), "דניאל שביאקוב")

    def test_extracts_only_valid_hebrew_names(self) -> None:
        payload = {
            "athletes": [
                {"id": 83703, "name": " נדב זמיר "},
                {"id": 125745, "name": "Ofek Nadir"},
                {"id": 100029, "name": ""},
                {"name": "שחקן ללא מזהה"},
                "invalid",
            ]
        }

        self.assertEqual(extract_hebrew_names(payload), {"83703": "נדב זמיר"})

    def test_handles_missing_athlete_collection(self) -> None:
        self.assertEqual(extract_hebrew_names({}), {})

    def test_extracts_athlete_and_lineup_ids_from_hebrew_game(self) -> None:
        payload = {
            "game": {
                "members": [
                    {"id": 111, "athleteId": 83703, "name": "נדב זמיר"},
                    {"id": 222, "name": "שחקן מחליף"},
                    {"id": 333, "athleteId": 125745, "name": "Ofek Nadir"},
                ]
            }
        }

        self.assertEqual(
            extract_game_hebrew_names(payload),
            {"83703": "נדב זמיר", "111": "נדב זמיר", "222": "שחקן מחליף"},
        )

    def test_chunks_ids_without_dropping_the_remainder(self) -> None:
        self.assertEqual(
            list(chunked(["1", "2", "3", "4", "5"], 2)),
            [["1", "2"], ["3", "4"], ["5"]],
        )

    def test_recognizes_positive_numeric_athlete_ids(self) -> None:
        self.assertTrue(is_365scores_athlete_id("83703"))
        self.assertFalse(is_365scores_athlete_id("0"))
        self.assertFalse(is_365scores_athlete_id("lineup-83703"))

    def test_builds_hebrew_athlete_request(self) -> None:
        url = athletes_url(["83703", "125745"])

        self.assertIn("langId=2", url)
        self.assertIn("athletes=83703%2C125745", url)

    def test_builds_hebrew_game_request(self) -> None:
        url = game_url("4461144")

        self.assertIn("langId=2", url)
        self.assertIn("gameId=4461144", url)

    def test_builds_english_search_request_for_unmapped_players(self) -> None:
        url = search_url("Liel Abada")

        self.assertIn("langId=1", url)
        self.assertIn("query=Liel+Abada", url)

    def test_extracts_google_hebrew_transliteration(self) -> None:
        payload = [[
            ["אופק ", "Ofek ", None, None, 1],
            ["לוי", "Levy", None, None, 1],
        ]]

        self.assertEqual(extract_transliterated_name(payload), "אופק לוי")
        self.assertIsNone(extract_transliterated_name([[['Ofek Levy']]]))

    def test_builds_english_to_hebrew_transliteration_request(self) -> None:
        url = transliteration_url("Ofek Levy")

        self.assertIn("sl=en", url)
        self.assertIn("tl=iw", url)
        self.assertIn("q=Ofek+Levy", url)

    @patch("scripts.backfill_hebrew_player_names.fetch_json")
    def test_transliteration_is_limited_to_verified_israeli_players(self, fetch_json) -> None:
        fetch_json.return_value = [[['טסט פלייר']]]
        players = [
            {"player_id": "israeli", "display_name": "Test Player", "is_israeli": True},
            {"player_id": "foreign", "display_name": "Gift Emmanuel", "is_israeli": False},
        ]

        names, verified, failures = transliterate_israeli_players(
            players,
            retries=0,
            sleep_seconds=0,
            workers=1,
            allow_fetch_failures=False,
        )

        self.assertEqual(names, {"israeli": "טסט פלייר"})
        self.assertEqual(verified, 0)
        self.assertEqual(failures, 0)
        fetch_json.assert_called_once()

    @patch("scripts.backfill_hebrew_player_names.fetch_json")
    def test_verified_spelling_wins_without_a_network_request(self, fetch_json) -> None:
        names, verified, failures = transliterate_israeli_players(
            [{"player_id": "mahdy", "display_name": "Mahdy Mhajne", "is_israeli": True}],
            retries=0,
            sleep_seconds=0,
            workers=1,
            allow_fetch_failures=False,
        )

        self.assertEqual(names, {"mahdy": "מהדי מחאגנה"})
        self.assertEqual(verified, 1)
        self.assertEqual(failures, 0)
        fetch_json.assert_not_called()

    def test_transfermarkt_fallback_requires_unique_israeli_identity(self) -> None:
        entities = {
            "519514": {
                "id": "519514",
                "name": "Liel Abada",
                "nationalityDetails": {
                    "passportName": "ליאל עבדה",
                    "nationalities": {"nationalityId": 74, "secondNationalityId": 0},
                },
            },
            "other": {
                "id": "other",
                "name": "Liel Abada",
                "nationalityDetails": {
                    "nationalities": {"nationalityId": 1, "secondNationalityId": 0},
                },
            },
        }

        self.assertEqual(
            select_transfermarkt_player("Liel Abada", ["519514", "other"], entities),
            entities["519514"],
        )


if __name__ == "__main__":
    unittest.main()
