import unittest

from scripts.backfill_hebrew_player_names import (
    athletes_url,
    chunked,
    extract_game_hebrew_names,
    extract_hebrew_names,
    game_url,
    is_365scores_athlete_id,
    search_url,
    select_transfermarkt_player,
)


class HebrewPlayerNameTests(unittest.TestCase):
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
