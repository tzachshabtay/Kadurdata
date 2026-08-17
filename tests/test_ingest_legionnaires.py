import unittest

from scripts.ingest_legionnaires import (
    chunked,
    completed_games,
    discover_historical_affiliations,
    discover_legionnaires,
    filter_legionnaire_player_rows,
    foreign_club_for_game,
    is_domestic_league,
)


class LegionnaireDiscoveryTests(unittest.TestCase):
    def test_chunked_keeps_every_id(self):
        self.assertEqual(chunked([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])

    def test_completed_games_do_not_depend_on_catalog_stat_flags(self):
        games = [{"id": 1, "statusGroup": 4}, {"id": 2, "statusGroup": 1}]
        self.assertEqual(completed_games(games), [{"id": 1, "statusGroup": 4}])

    def test_only_discovered_israeli_athletes_are_written(self):
        rows = [
            {"athlete_id": 10, "player_name": "Israeli Abroad"},
            {"athlete_id": 20, "player_name": "League Opponent"},
            {"athlete_id": None, "player_name": "Unknown"},
        ]
        self.assertEqual(
            filter_legionnaire_player_rows(rows, {10}),
            [{"athlete_id": 10, "player_name": "Israeli Abroad"}],
        )

    def test_discovery_keeps_only_israelis_at_foreign_clubs(self):
        athletes = [
            {
                "id": 10,
                "name": "Israeli Abroad",
                "sportId": 1,
                "nationalityId": 6,
                "clubId": 100,
                "position": {"name": "Midfielder"},
                "formationPosition": {"name": "Central Midfield"},
            },
            {"id": 11, "name": "Israeli Home", "sportId": 1, "nationalityId": 6, "clubId": 101},
            {"id": 12, "name": "Foreign Player", "sportId": 1, "nationalityId": 1, "clubId": 100},
        ]
        competitors = {
            100: {"id": 100, "name": "Foreign FC", "countryId": 1, "type": 1, "mainCompetitionId": 200},
            101: {"id": 101, "name": "Israeli FC", "countryId": 6, "type": 1, "mainCompetitionId": 201},
        }
        competitions = {
            200: {"id": 200, "name": "Foreign League", "currentSeasonNum": 20},
            201: {"id": 201, "name": "Israeli League", "currentSeasonNum": 20},
        }

        rows, failures = discover_legionnaires(athletes, competitors, competitions)

        self.assertEqual(failures, [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["athlete_id"], 10)
        self.assertEqual(rows[0]["competition_name"], "Foreign League")

    def test_foreign_club_is_read_from_the_players_side_of_a_game(self):
        wrapper = {
            "relatedCompetitor": 100,
            "game": {
                "homeCompetitor": {"id": 100, "type": 1, "countryId": 1},
                "awayCompetitor": {"id": 200, "type": 1, "countryId": 2},
            },
        }
        self.assertEqual(foreign_club_for_game(wrapper)["id"], 100)

        wrapper["game"]["homeCompetitor"]["countryId"] = 6
        self.assertIsNone(foreign_club_for_game(wrapper))

    def test_domestic_league_rejects_cups_and_international_competitions(self):
        self.assertTrue(is_domestic_league({"name": "Premier League", "currentStageType": 1}))
        self.assertFalse(is_domestic_league({"name": "FA Cup", "currentStageType": 3}))
        self.assertFalse(is_domestic_league({"name": "Champions League", "isInternational": True}))

    def test_historical_affiliations_use_the_actual_foreign_league(self):
        athletes = [{
            "id": 10,
            "name": "Israeli Abroad",
            "nationalityId": 6,
            "position": {"name": "Midfielder"},
            "formationPosition": {"name": "Central Midfield"},
        }]
        current_rows = [{
            "athlete_id": 10,
            "player_name": "Israeli Abroad",
            "country_id": 6,
            "position_name": "Midfielder",
            "formation_position": "Central Midfield",
            "club_id": 300,
            "club_name": "Current FC",
            "club_country_id": 3,
            "competition_id": 400,
            "competition_name": "Current League",
            "season_num": 30,
            "is_current": True,
        }]
        games_by_athlete = {10: [
            {
                "relatedCompetitor": 100,
                "game": {
                    "id": 1,
                    "competitionId": 200,
                    "seasonNum": 20,
                    "startTime": "2025-10-01T18:00:00+00:00",
                    "homeCompetitor": {"id": 100, "type": 1, "countryId": 1},
                    "awayCompetitor": {"id": 101, "type": 1, "countryId": 1},
                },
            },
            {
                "relatedCompetitor": 100,
                "game": {
                    "id": 2,
                    "competitionId": 201,
                    "seasonNum": 21,
                    "startTime": "2025-11-01T18:00:00+00:00",
                    "homeCompetitor": {"id": 100, "type": 1, "countryId": 1},
                    "awayCompetitor": {"id": 102, "type": 1, "countryId": 1},
                },
            },
        ]}
        competitors = {
            100: {
                "id": 100,
                "name": "Historical FC",
                "countryId": 1,
                "type": 1,
                "mainCompetitionId": 200,
            },
        }
        competitions = {
            200: {"id": 200, "name": "Historical League", "currentStageType": 1},
            201: {"id": 201, "name": "Historical Cup", "currentStageType": 3},
        }

        rows = discover_historical_affiliations(
            current_rows,
            athletes,
            games_by_athlete,
            competitors,
            competitions,
            "2025-07-01",
            "2026-06-30",
        )

        self.assertEqual(len(rows), 2)
        historical = next(row for row in rows if not row["is_current"])
        self.assertEqual(historical["club_name"], "Historical FC")
        self.assertEqual(historical["competition_name"], "Historical League")
        self.assertEqual(historical["season_num"], 20)


if __name__ == "__main__":
    unittest.main()
