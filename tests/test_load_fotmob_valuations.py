import unittest

from scripts.load_fotmob_valuations_to_supabase import build_valuation_series


class FotMobValuationLoaderTests(unittest.TestCase):
    def test_builds_sorted_compact_series(self) -> None:
        rows = [
            {
                "canonical_player_id": "player-1",
                "source_player_id": "source-1",
                "valuation_date": "2026-08-01",
                "value_amount": "1500000",
                "currency": "EUR",
                "lower_bound": "1200000",
                "upper_bound": "1800000",
                "provider": "scisports",
                "source_url": "https://example.com/player",
            },
            {
                "canonical_player_id": "player-1",
                "source_player_id": "source-1",
                "valuation_date": "2025-08-01",
                "value_amount": "1000000",
                "currency": "EUR",
                "lower_bound": "",
                "upper_bound": "",
                "provider": "scisports",
                "source_url": "https://example.com/player",
            },
        ]

        series = build_valuation_series(rows)

        self.assertEqual(len(series), 1)
        self.assertEqual(series[0]["valuation_dates"], ["2025-08-01", "2026-08-01"])
        self.assertEqual(series[0]["value_amounts"], [1000000, 1500000])
        self.assertEqual(series[0]["lower_bounds"], [None, 1200000])
        self.assertEqual(series[0]["upper_bounds"], [None, 1800000])

    def test_rejects_mixed_currencies(self) -> None:
        rows = [
            {
                "canonical_player_id": "player-1",
                "source_player_id": "source-1",
                "valuation_date": "2025-08-01",
                "value_amount": "1000000",
                "currency": "EUR",
            },
            {
                "canonical_player_id": "player-1",
                "source_player_id": "source-1",
                "valuation_date": "2026-08-01",
                "value_amount": "1200000",
                "currency": "USD",
            },
        ]

        with self.assertRaises(RuntimeError):
            build_valuation_series(rows)


if __name__ == "__main__":
    unittest.main()
