import unittest

from scripts.team_stat_values import parse_team_stat_value, team_stat_value_type


class TeamStatValueTests(unittest.TestCase):
    def test_prefers_native_count_over_comparison_share(self) -> None:
        self.assertEqual(parse_team_stat_value("10", "0.38"), (10.0, "10"))

    def test_preserves_native_percentage(self) -> None:
        self.assertEqual(parse_team_stat_value("53%", "0.53"), (53.0, "53%"))

    def test_uses_completed_value_from_ratio(self) -> None:
        self.assertEqual(parse_team_stat_value("5/16 (31%)", "0.55"), (5.0, "5/16 (31%)"))

    def test_uses_share_only_when_native_value_is_missing(self) -> None:
        self.assertEqual(parse_team_stat_value("", "0.42"), (42.0, "0.42"))

    def test_only_native_percentages_have_percentage_type(self) -> None:
        self.assertEqual(team_stat_value_type("53%"), "percentage")
        self.assertEqual(team_stat_value_type("10"), "count")
        self.assertEqual(team_stat_value_type("5/16 (31%)"), "count")


if __name__ == "__main__":
    unittest.main()
