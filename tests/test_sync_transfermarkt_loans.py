import unittest
from datetime import date

from scripts.sync_transfermarkt_loans import (
    canonical_player_name,
    enrich_loan_stubs,
    extract_api_departure_loans,
    normalized_team_name,
    resolve_transfermarkt_team,
    select_team_suggestion,
)


class TransfermarktLoanTests(unittest.TestCase):
    def test_known_israeli_club_does_not_depend_on_remote_search(self) -> None:
        selected = resolve_transfermarkt_team("Maccabi Tel Aviv FC", 0, 0)
        self.assertIsNotNone(selected)
        self.assertEqual(selected["id"], "119")

    def test_reconciles_transfermarkt_player_name_variants(self) -> None:
        self.assertEqual(canonical_player_name("Roy Nawi"), "roy navi")
        self.assertEqual(canonical_player_name("Itay Zafrani"), "itai zafrani")

    def test_normalizes_club_suffixes_for_automatic_discovery(self) -> None:
        self.assertEqual(normalized_team_name("Maccabi Tel Aviv FC"), "maccabi tel aviv")
        self.assertEqual(normalized_team_name("FC Ashdod"), "ashdod")

    def test_selects_exact_senior_team_from_api_results(self) -> None:
        suggestions = [
            {"id": "19856", "name": "Maccabi Tel Aviv U19"},
            {"id": "119", "name": "Maccabi Tel Aviv"},
        ]
        selected = select_team_suggestion(suggestions, "Maccabi Tel Aviv FC")
        self.assertIsNotNone(selected)
        self.assertEqual(selected["id"], "119")

    def test_extracts_only_started_outgoing_loans_for_requested_season(self) -> None:
        payload = {
            "success": True,
            "data": {
                "clubId": "119",
                "departures": {
                    "terminated": [
                        {
                            "id": "6444348",
                            "transferSource": {"clubId": "119"},
                            "transferDestination": {"clubId": "4769"},
                            "details": {
                                "playerId": "1002512",
                                "date": "2026-07-21T00:00:00+02:00",
                                "seasonId": 2026,
                                "isPending": False,
                            },
                            "typeDetails": {"type": "ACTIVE_LOAN_TRANSFER"},
                            "relativeUrl": "/amit-karadi/transfers/spieler/1002512/transfer_id/6444348",
                        },
                        {
                            "id": "standard",
                            "transferSource": {"clubId": "119"},
                            "transferDestination": {"clubId": "2"},
                            "details": {"playerId": "3", "date": "2026-07-01", "seasonId": 2026},
                            "typeDetails": {"type": "STANDARD"},
                        },
                    ],
                    "pending": [],
                },
            },
        }
        parent = {"transfermarkt_team_id": "119", "team_name": "Maccabi Tel Aviv"}

        loans = extract_api_departure_loans(payload, parent, 2026, today=date(2026, 8, 18))

        self.assertEqual(len(loans), 1)
        self.assertEqual(loans[0]["source_player_id"], "1002512")
        self.assertEqual(loans[0]["source_destination_team_id"], "4769")
        self.assertEqual(loans[0]["started_on"], date(2026, 7, 21))

    def test_enriches_players_positions_hebrew_names_and_clubs(self) -> None:
        stubs = [{
            "source_player_id": "1002512",
            "source_destination_team_id": "4769",
            "season_start_year": 2026,
        }]
        players = {
            "1002512": {
                "id": "1002512",
                "name": "Amit Karadi",
                "nationalityDetails": {"passportName": "\u05e2\u05de\u05d9\u05ea \u05e7\u05e8\u05d3\u05d9"},
                "attributes": {
                    "positionGroup": "DEFENDER",
                    "position": {"name": "Left-Back", "shortName": "LB"},
                },
            }
        }
        clubs = {"4769": {"id": "4769", "name": "Ihud Bnei Sakhnin"}}

        loans = enrich_loan_stubs(stubs, players, clubs)

        self.assertEqual(loans[0]["player_name"], "Amit Karadi")
        self.assertEqual(loans[0]["player_name_he"], "\u05e2\u05de\u05d9\u05ea \u05e7\u05e8\u05d3\u05d9")
        self.assertEqual(loans[0]["primary_position"], "Defender")
        self.assertEqual(loans[0]["formation_position"], "Left-Back")
        self.assertEqual(loans[0]["destination_team_name"], "Ihud Bnei Sakhnin")
        self.assertEqual(loans[0]["ended_on"], date(2027, 6, 30))


if __name__ == "__main__":
    unittest.main()
