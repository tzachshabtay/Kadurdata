import json
import unittest

from scripts.ingest_fotmob_valuations import (
    extract_market_values,
    search_suggestions,
    select_search_match,
)


class FotMobValuationTests(unittest.TestCase):
    def test_extracts_and_deduplicates_market_value_history(self) -> None:
        market_values = {
            "values": [
                {
                    "date": "2025-06-30T00:00:00+00:00",
                    "value": 1200000,
                    "currency": "EUR",
                    "lowerBound": 900000,
                    "upperBound": 1500000,
                    "source": "scisports",
                    "teamId": 9754,
                    "teamName": "Hapoel Beer Sheva",
                },
                {
                    "date": "2026-06-30T00:00:00+00:00",
                    "value": 1445982.4,
                    "currency": "eur",
                    "lowerBound": 1100000,
                    "upperBound": 1800000,
                    "source": "scisports",
                },
            ]
        }
        encoded = json.dumps(market_values, separators=(",", ":"))
        html = f'<script>self.__next_f.push([1,"x"])</script>"marketValues":{encoded}{encoded}'

        values = extract_market_values(html)

        self.assertEqual(len(values), 2)
        self.assertEqual(values[-1]["valuation_date"], "2026-06-30")
        self.assertEqual(values[-1]["value_amount"], 1445982)
        self.assertEqual(values[-1]["currency"], "EUR")
        self.assertEqual(values[0]["source_team_name"], "Hapoel Beer Sheva")

    def test_search_match_uses_club_to_disambiguate_names(self) -> None:
        suggestions = [
            {"type": "player", "id": "846750", "name": "Lucas Ventura", "teamName": "Hapoel Beer Sheva"},
            {"type": "player", "id": "1285629", "name": "Lucas Ventura", "teamName": "Zacatecoluca"},
        ]

        match = select_search_match(suggestions, "Lucas Ventura", "Hapoel Be'er Sheva FC")

        self.assertIsNotNone(match)
        self.assertEqual(match["id"], "846750")

    def test_ambiguous_search_without_matching_club_is_rejected(self) -> None:
        suggestions = [
            {"type": "player", "id": "1", "name": "Test Player", "teamName": "One"},
            {"type": "player", "id": "2", "name": "Test Player", "teamName": "Two"},
        ]

        self.assertIsNone(select_search_match(suggestions, "Test Player", "Three"))

    def test_search_match_accepts_team_anchored_transliteration(self) -> None:
        suggestions = [
            {"type": "player", "id": "1116740", "name": "Ido Shahar", "teamName": "Maccabi Tel Aviv"},
        ]

        match = select_search_match(suggestions, "Ido Shachar", "Maccabi Tel Aviv FC")

        self.assertIsNotNone(match)
        self.assertEqual(match["id"], "1116740")

    def test_search_groups_are_deduplicated(self) -> None:
        item = {"type": "player", "id": "7", "name": "Player", "isCoach": False}
        payload = [
            {"title": {"key": "all"}, "suggestions": [item]},
            {"title": {"key": "players"}, "suggestions": [item]},
        ]

        self.assertEqual(search_suggestions(payload), [item])


if __name__ == "__main__":
    unittest.main()
