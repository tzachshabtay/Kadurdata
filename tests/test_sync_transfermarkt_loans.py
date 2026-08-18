import unittest
from datetime import date

from scripts.sync_transfermarkt_loans import (
    extract_departure_loans,
    extract_transfer_date,
    select_team_suggestion,
    transfermarkt_team_suggestions,
)


class TransfermarktLoanTests(unittest.TestCase):
    def test_resolves_exact_senior_team_from_search_results(self) -> None:
        html = """
        <a href="/maccabi-tel-aviv-u19/startseite/verein/19856" title="Maccabi Tel Aviv U19">Youth</a>
        <a href="/maccabi-tel-aviv/startseite/verein/119" title="Maccabi Tel Aviv">Senior</a>
        """
        selected = select_team_suggestion(transfermarkt_team_suggestions(html), "Maccabi Tel Aviv")
        self.assertIsNotNone(selected)
        self.assertEqual(selected["id"], "119")

    def test_extracts_only_outgoing_loan_transfers(self) -> None:
        html = """
        <div class="box">
          <h2>Departures</h2>
          <table class="items"><tbody>
            <tr>
              <td><table><tr><td><a href="/ori-azo/profil/spieler/926481" title="Ori Azo">Ori Azo</a></td></tr><tr><td>Left Winger</td></tr></table></td>
              <td><a href="/fc-ashdod/startseite/verein/6105" title="FC Ashdod">FC Ashdod</a></td>
              <td><a href="/jumplist/transfers/spieler/926481/transfer_id/5953651">loan transfer</a></td>
            </tr>
            <tr>
              <td><a href="/sold/profil/spieler/1">Sold Player</a></td>
              <td><a href="/buyer/startseite/verein/2" title="Buyer">Buyer</a></td>
              <td>€2m</td>
            </tr>
          </tbody></table>
        </div>
        """
        parent = {"transfermarkt_team_id": "119", "team_name": "Maccabi Tel Aviv"}

        loans = extract_departure_loans(html, parent, 2025)

        self.assertEqual(len(loans), 1)
        self.assertEqual(loans[0]["source_player_id"], "926481")
        self.assertEqual(loans[0]["source_destination_team_id"], "6105")
        self.assertEqual(loans[0]["formation_position"], "Left Winger")
        self.assertEqual(loans[0]["primary_position"], "Attacker")

    def test_extracts_exact_transfer_date(self) -> None:
        html = "<div>Transfer date <strong>Season 25/26 - 21/09/2025</strong></div>"
        self.assertEqual(extract_transfer_date(html), date(2025, 9, 21))


if __name__ == "__main__":
    unittest.main()
