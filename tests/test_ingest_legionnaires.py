import unittest

from scripts.ingest_legionnaires import chunked, discover_legionnaires


class LegionnaireDiscoveryTests(unittest.TestCase):
    def test_chunked_keeps_every_id(self):
        self.assertEqual(chunked([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])

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


if __name__ == "__main__":
    unittest.main()
