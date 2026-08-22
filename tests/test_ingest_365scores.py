import unittest
from argparse import Namespace

from scripts.ingest_365scores import (
    competition_seasons,
    flatten_shot_events,
    game_has_country_participant,
    game_season_num,
    inferred_season_name,
    israel_related_competitions,
    normalize_competition,
    page_params,
)


class CompetitionCatalogTests(unittest.TestCase):
    def test_flattens_shot_chart_coordinates_and_player_mapping(self) -> None:
        rows = flatten_shot_events(
            {
                4702029: {
                    "game": {
                        "id": 4702029,
                        "homeCompetitor": {"id": 562, "name": "Home"},
                        "awayCompetitor": {"id": 579, "name": "Away"},
                        "members": [
                            {"id": 501686, "athleteId": 7519, "name": "Player", "competitorId": 562}
                        ],
                        "chartEvents": {
                            "eventSubTypes": [{"value": 4, "name": "Regular Play"}],
                            "events": [
                                {
                                    "key": "14702029",
                                    "competitorNum": 1,
                                    "playerId": 501686,
                                    "time": "8'",
                                    "line": 32.1,
                                    "side": 80.0,
                                    "subType": 4,
                                    "bodyPart": "Left foot",
                                    "outcome": {"name": "Blocked", "x": 83.4, "y": 38.4},
                                    "xg": "-",
                                    "xgot": "0.00",
                                }
                            ],
                        },
                    }
                }
            }
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source_event_id"], "14702029")
        self.assertEqual(rows[0]["player_source_id"], 7519)
        self.assertEqual(rows[0]["team_id"], 562)
        self.assertEqual(rows[0]["shot_x"], 80.0)
        self.assertEqual(rows[0]["shot_y"], 32.1)
        self.assertEqual(rows[0]["situation"], "Regular Play")
        self.assertIsNone(rows[0]["xg"])
        self.assertEqual(rows[0]["xgot"], 0.0)

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

    def test_normalizes_national_youth_competition(self) -> None:
        competition = normalize_competition(
            {
                "id": 322,
                "name": "Euro U21 Qualification",
                "countryId": 19,
                "competitorsType": 2,
            }
        )

        self.assertEqual(competition["age_group"], "under_21")
        self.assertEqual(competition["participant_type"], "national_team")
        self.assertEqual(competition["source_country_id"], 19)

    def test_selects_only_curated_israel_related_competitions(self) -> None:
        competitions = israel_related_competitions(
            {
                "competitions": [
                    {"id": 572, "name": "UEFA Champions League", "competitorsType": 1},
                    {"id": 7016, "name": "UEFA Nations League", "competitorsType": 2},
                    {"id": 11, "name": "LaLiga", "competitorsType": 1},
                ]
            }
        )

        self.assertEqual([item["id"] for item in competitions], [572, 7016])
        self.assertEqual(competitions[0]["scope"], "european_club")
        self.assertEqual(competitions[1]["scope"], "national_team")
        self.assertTrue(all(item["participant_country_filter"] == 6 for item in competitions))

    def test_filters_external_games_to_israeli_participants(self) -> None:
        israel_game = {
            "homeCompetitor": {"name": "Maccabi Tel Aviv", "countryId": 6},
            "awayCompetitor": {"name": "Basel", "countryId": 15},
        }
        unrelated_game = {
            "homeCompetitor": {"name": "Basel", "countryId": 15},
            "awayCompetitor": {"name": "Ajax", "countryId": 7},
        }

        self.assertTrue(game_has_country_participant(israel_game, 6))
        self.assertFalse(game_has_country_participant(unrelated_game, 6))

    def test_preserves_competitor_filter_when_paging(self) -> None:
        params = page_params(
            Namespace(app_type_id=5, lang_id=1, timezone="Asia/Jerusalem", user_country_id=6),
            "/web/games/?competitors=5034&games=1&aftergame=4314041&direction=-1",
        )

        self.assertIsNotNone(params)
        self.assertEqual(params["competitors"], "5034")
        self.assertNotIn("competitions", params)

    def test_infers_season_number_for_friendlies(self) -> None:
        self.assertEqual(game_season_num({"startTime": "2025-11-13T19:00:00+02:00"}), 2025)
        self.assertEqual(game_season_num({"startTime": "2026-06-03T21:00:00+03:00"}), 2025)

    def test_infers_cross_year_season(self) -> None:
        games = [
            {"startTime": "2025-08-23T20:00:00+03:00"},
            {"startTime": "2026-05-23T20:00:00+03:00"},
        ]

        self.assertEqual(inferred_season_name(games), "2025/2026")

    def test_infers_calendar_year_season_from_both_halves(self) -> None:
        games = [
            {"startTime": "2026-02-22T20:00:00+02:00"},
            {"startTime": "2026-05-23T20:00:00+03:00"},
            {"startTime": "2026-08-20T20:00:00+03:00"},
        ]

        self.assertEqual(inferred_season_name(games), "2026/2027")

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
