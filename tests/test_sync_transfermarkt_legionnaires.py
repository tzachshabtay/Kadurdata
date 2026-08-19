import unittest

from scripts.sync_transfermarkt_legionnaires import (
    current_season_name,
    parse_destination_countries,
    parse_legionnaire_players,
)


class TransfermarktLegionnaireCensusTests(unittest.TestCase):
    def test_parses_destination_country(self) -> None:
        html = """
        <div id="yw1"><table class="items"><tbody><tr>
          <td><a href="/spieler-statistik/legionaere/statistik/stat/land_id/74/land/184">United States</a></td>
        </tr></tbody></table></div>
        """

        self.assertEqual(
            parse_destination_countries(html),
            [{"country_id": "184", "country_name": "United States"}],
        )

    def test_parses_player_club_and_league(self) -> None:
        html = """
        <div id="yw1"><table class="items"><tbody><tr>
          <td>1</td>
          <td><table class="inline-table">
            <tr><td></td><td><a title="Liel Abada" href="/liel-abada/profil/spieler/519514">Liel Abada</a></td></tr>
            <tr><td>Right Winger</td></tr>
          </table></td>
          <td>24</td><td>Israel</td>
          <td><table class="inline-table">
            <tr><td><a title="Charlotte FC" href="/charlotte-fc/startseite/verein/78435">Charlotte</a></td></tr>
            <tr><td><a title="Major League Soccer" href="/major-league-soccer/startseite/wettbewerb/MLS1">MLS</a></td></tr>
          </table></td>
        </tr></tbody></table></div>
        """

        self.assertEqual(
            parse_legionnaire_players(html, country_id="184", country_name="United States"),
            [{
                "source_player_id": "519514",
                "player_name": "Liel Abada",
                "listed_position": "Right Winger",
                "source_team_id": "78435",
                "team_name": "Charlotte FC",
                "source_competition_id": "MLS1",
                "competition_name": "Major League Soccer",
                "destination_country_id": "184",
                "destination_country_name": "United States",
            }],
        )

    def test_keeps_players_whose_club_has_no_listed_league(self) -> None:
        html = """
        <div id="yw1"><table class="items"><tbody><tr>
          <td>1</td>
          <td><table class="inline-table"><tr><td><a title="Roy Zaltz" href="/roy-zaltz/profil/spieler/1352134">Roy Zaltz</a></td></tr><tr><td>Defender</td></tr></table></td>
          <td>21</td><td>Israel</td>
          <td><a title="Cal Poly Pomona Broncos" href="/cal-poly-pomona-broncos/startseite/verein/53334">CPP Broncos</a></td>
        </tr></tbody></table></div>
        """

        player = parse_legionnaire_players(html, country_id="184", country_name="United States")[0]

        self.assertEqual(player["source_competition_id"], "country-184")
        self.assertEqual(player["competition_name"], "Other clubs - United States")

    def test_uses_football_season_label(self) -> None:
        from datetime import date

        self.assertEqual(current_season_name(date(2026, 8, 18)), "2026/2027")
        self.assertEqual(current_season_name(date(2026, 2, 18)), "2025/2026")


if __name__ == "__main__":
    unittest.main()
