import unittest

from scripts.backfill_hebrew_player_names import (
    athletes_url,
    chunked,
    extract_hebrew_names,
    is_365scores_athlete_id,
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


if __name__ == "__main__":
    unittest.main()
