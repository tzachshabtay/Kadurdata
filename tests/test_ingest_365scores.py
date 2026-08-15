import unittest

from scripts.ingest_365scores import (
    competition_seasons,
    inferred_season_name,
    normalize_competition,
)


class CompetitionCatalogTests(unittest.TestCase):
    def test_normalizes_competition_shape(self) -> None:
        competition = normalize_competition(
            {
                "id": 7620,
                "name": "Women's Premier League",
                "currentSeasonNum": 16,
                "hasStats": False,
                "hasHistory": True,
                "hasStandings": True,
            }
        )

        self.assertEqual(competition["gender"], "women")
        self.assertEqual(competition["competition_type"], "league")
        self.assertEqual(competition["current_season_num"], 16)

    def test_infers_cross_year_season(self) -> None:
        games = [
            {"startTime": "2025-08-23T20:00:00+03:00"},
            {"startTime": "2026-05-23T20:00:00+03:00"},
        ]

        self.assertEqual(inferred_season_name(games), "2025/2026")

    def test_source_history_name_wins(self) -> None:
        competition = {"current_season_num": 42}
        games = [
            {
                "id": 1,
                "seasonNum": 42,
                "startTime": "2026-07-18T20:00:00+03:00",
            }
        ]
        history = [{"num": 42, "name": "2026", "has_table": False, "has_group": True}]

        seasons = competition_seasons(competition, games, history)

        self.assertEqual(seasons[0]["name"], "2026")
        self.assertTrue(seasons[0]["is_current"])


if __name__ == "__main__":
    unittest.main()
