import unittest

from scripts.player_stat_values import rating_value


class PlayerStatValueTests(unittest.TestCase):
    def test_treats_negative_rating_as_missing(self) -> None:
        self.assertIsNone(rating_value("-1"))

    def test_preserves_real_rating(self) -> None:
        self.assertEqual(rating_value("7.4"), 7.4)

    def test_handles_empty_rating(self) -> None:
        self.assertIsNone(rating_value(""))


if __name__ == "__main__":
    unittest.main()
