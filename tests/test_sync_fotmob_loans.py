import unittest
from datetime import date

from scripts.sync_fotmob_loans import (
    current_season_start,
    extract_team_loans,
    extract_team_roster,
    normalized_name,
    primary_position,
    select_team_suggestion,
    source_team_key,
)


class FotMobLoanTests(unittest.TestCase):
    def test_current_season_starts_in_july(self) -> None:
        self.assertEqual(current_season_start(date(2026, 8, 18)), date(2026, 7, 1))
        self.assertEqual(current_season_start(date(2026, 3, 1)), date(2025, 7, 1))

    def test_selects_exact_team_name_before_search_score(self) -> None:
        suggestions = [
            {"id": "1", "name": "Maccabi Haifa Youth", "score": 999},
            {"id": "2", "name": "Maccabi Haifa", "score": 10},
        ]
        self.assertEqual(select_team_suggestion(suggestions, "Maccabi Haifa")["id"], "2")

    def test_extracts_only_explicit_loans(self) -> None:
        payload = {
            "transfers": {
                "allTransfers": [
                    {
                        "name": "Loaned Player",
                        "playerId": 123,
                        "fromClubId": 10,
                        "fromClub": "Parent FC",
                        "toClubId": 20,
                        "toClub": "Destination FC",
                        "onLoan": True,
                        "fromDate": "2026-07-01T00:00:00Z",
                        "toDate": "2027-06-30T00:00:00Z",
                        "position": {"label": "DM", "key": "centerdefensivemidfielder_short"},
                    },
                    {
                        "name": "Transferred Player",
                        "playerId": 456,
                        "fromClubId": 10,
                        "fromClub": "Parent FC",
                        "toClubId": 30,
                        "toClub": "Buyer FC",
                        "onLoan": False,
                    },
                ]
            }
        }

        loans = extract_team_loans(payload, "10")

        self.assertEqual(len(loans), 1)
        self.assertEqual(loans[0]["source_player_id"], "123")
        self.assertEqual(loans[0]["started_on"], date(2026, 7, 1))
        self.assertEqual(loans[0]["ended_on"], date(2027, 6, 30))
        self.assertEqual(loans[0]["primary_position"], "Midfielder")
        self.assertEqual(loans[0]["formation_position"], "DM")

    def test_missing_fotmob_team_id_uses_stable_name_key(self) -> None:
        self.assertEqual(source_team_key(-1, "Kryvbas FC"), "name:kryvbas")
        self.assertEqual(normalized_name("Maccabi Tel-Aviv FC"), "maccabi tel aviv")

    def test_position_grouping_handles_short_labels(self) -> None:
        self.assertEqual(primary_position({"position": {"label": "CB"}}), "Defender")
        self.assertEqual(primary_position({"position": {"label": "RW"}}), "Attacker")

    def test_extracts_current_players_and_management_from_roster_groups(self) -> None:
        payload = {
            "overview": {"season": "2026/2027"},
            "squad": {"squad": [
                {"title": "coach", "members": [
                    {"id": 1, "name": "The Coach", "role": {"fallback": "Coach"}},
                ]},
                {"title": "defenders", "members": [
                    {
                        "id": 2,
                        "name": "The Defender",
                        "shirtNumber": 3,
                        "role": {"fallback": "Defender"},
                        "positionIds": "38,59",
                        "positionIdsDesc": "LB,LWB",
                    },
                ]},
            ]},
        }

        season_name, roster = extract_team_roster(payload, "7855")

        self.assertEqual(season_name, "2026/2027")
        self.assertEqual(len(roster), 2)
        self.assertEqual(roster[0]["primary_position"], "Management")
        self.assertEqual(roster[1]["primary_position"], "Defender")
        self.assertEqual(roster[1]["formation_position"], "LB")
        self.assertEqual(roster[1]["shirt_number"], 3)


if __name__ == "__main__":
    unittest.main()
