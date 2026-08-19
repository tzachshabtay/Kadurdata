import unittest

from scripts.backfill_hebrew_team_names import (
    chunked,
    competitors_url,
    extract_hebrew_competitors,
)


class HebrewTeamNamesTest(unittest.TestCase):
    def test_competitors_url_requests_hebrew_names(self):
        url = competitors_url(["574", "559"])

        self.assertIn("langId=2", url)
        self.assertIn("competitors=574%2C559", url)

    def test_extract_hebrew_competitors_ignores_non_hebrew_names(self):
        payload = {
            "competitors": [
                {"id": 574, "name": "הפועל רמת גן"},
                {"id": 559, "name": "Beitar Jerusalem"},
                {"id": 564, "longName": "מכבי פתח תקוה", "name": "מכבי פתח תקוה"},
            ]
        }

        self.assertEqual(
            extract_hebrew_competitors(payload),
            {"574": "הפועל רמת גן", "564": "מכבי פתח תקוה"},
        )

    def test_chunked_rejects_invalid_batch_size(self):
        with self.assertRaises(ValueError):
            list(chunked(["1"], 0))


if __name__ == "__main__":
    unittest.main()
