import unittest

from scripts.ingest_fotmob import (
    fixture_row,
    flatten_player_stats,
    parse_season_labels,
    selected_seasons,
)


class FotMobHistoryTests(unittest.TestCase):
    def test_default_seasons_exclude_365scores_coverage(self) -> None:
        seasons = selected_seasons(
            ["2026/2027", "2025/2026", "2024/2025", "2023/2024"],
            None,
        )

        self.assertEqual(seasons, ["2024/2025", "2023/2024"])

    def test_scheduled_placeholder_score_is_not_completed(self) -> None:
        row = fixture_row(
            {
                "id": "1",
                "round": "1",
                "home": {"id": "10", "name": "Home"},
                "away": {"id": "20", "name": "Away"},
                "status": {
                    "utcTime": "2026-08-22T17:00:00Z",
                    "finished": False,
                    "started": False,
                    "scoreStr": "-1 - -1",
                },
            },
            "2026/2027",
        )

        self.assertEqual(row["status_text"], "Scheduled")
        self.assertEqual((row["home_score"], row["away_score"]), (-1, -1))

    def test_fixture_uses_configured_foreign_league_id(self) -> None:
        row = fixture_row(
            {
                "id": "1",
                "home": {"id": "10", "name": "Home"},
                "away": {"id": "20", "name": "Away"},
                "status": {"finished": True, "scoreStr": "2 - 1"},
            },
            "2025",
            130,
        )

        self.assertEqual(row["competition_id"], 130)
        self.assertEqual(row["season_num"], 2025)

    def test_calendar_year_season_can_map_to_app_label(self) -> None:
        self.assertEqual(
            parse_season_labels("2025=2025/2026,2026=2026/2027"),
            {"2025": "2025/2026", "2026": "2026/2027"},
        )

    def test_flattens_fraction_metrics(self) -> None:
        fixture = {
            "game_id": "1",
            "home_team_id": "10",
            "away_team_id": "20",
        }
        props = {
            "content": {
                "lineup": {
                    "homeTeam": {
                        "formation": "4-3-3",
                        "starters": [
                            {
                                "id": 7,
                                "shirtNumber": "8",
                                "usualPlayingPositionId": 2,
                            }
                        ],
                        "subs": [],
                    },
                    "awayTeam": {"starters": [], "subs": []},
                },
                "playerStats": {
                    "7": {
                        "name": "Test Player",
                        "teamId": 10,
                        "isGoalkeeper": False,
                        "stats": [
                            {
                                "stats": {
                                    "Accurate passes": {
                                        "key": "accurate_passes",
                                        "stat": {
                                            "value": 27,
                                            "total": 30,
                                            "type": "fractionWithPercentage",
                                        },
                                    }
                                }
                            }
                        ],
                    }
                },
            }
        }

        row = flatten_player_stats(props, fixture)[0]

        self.assertEqual(row["stat_passes_completed_value"], 27)
        self.assertEqual(row["stat_passes_completed_attempted"], 30)
        self.assertEqual(row["stat_passes_completed_percentage"], 90)
        self.assertEqual(row["lineup_status_text"], "Started")


if __name__ == "__main__":
    unittest.main()
