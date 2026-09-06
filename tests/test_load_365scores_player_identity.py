import inspect
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

try:
    import psycopg  # noqa: F401
except ModuleNotFoundError:
    psycopg_stub = types.ModuleType("psycopg")
    psycopg_stub.sql = types.SimpleNamespace()
    rows_stub = types.ModuleType("psycopg.rows")
    rows_stub.dict_row = object()
    types_stub = types.ModuleType("psycopg.types")
    json_stub = types.ModuleType("psycopg.types.json")
    json_stub.Jsonb = lambda value: value
    with patch.dict(
        sys.modules,
        {
            "psycopg": psycopg_stub,
            "psycopg.rows": rows_stub,
            "psycopg.types": types_stub,
            "psycopg.types.json": json_stub,
        },
    ):
        from scripts import load_365scores_to_supabase as loader
else:
    from scripts import load_365scores_to_supabase as loader


def player_row(
    source_player_id: str,
    name: str,
    team_id: str,
    match_id: str | None = None,
    *,
    jersey_number: str | int | None = None,
    lineup_status: str | None = None,
    minutes: str | float | None = None,
    position: str | None = None,
    formation: str | None = None,
) -> dict:
    return {
        "source_player_id": source_player_id,
        "team_id": team_id,
        "match_id": match_id or f"match-{source_player_id}",
        "row": {
            "player_name": name,
            "jersey_number": jersey_number,
            "lineup_status_text": lineup_status,
            "stat_minutes_value": minutes,
            "position_name": position,
            "formation_name": formation,
        },
    }


def candidate(
    canonical_id: str,
    source_entity_id: str,
    name: str,
    team_id: str,
    is_lineup_fallback: bool | None = None,
) -> dict:
    return {
        "canonical_id": canonical_id,
        "source_entity_id": source_entity_id,
        "player_name": name,
        "team_id": team_id,
        "is_lineup_fallback": is_lineup_fallback,
    }


class PlayerIdentityLoadingTests(unittest.TestCase):
    def test_non_positive_shirt_numbers_are_treated_as_missing(self) -> None:
        self.assertIsNone(loader.positive_int(None))
        self.assertIsNone(loader.positive_int("-1"))
        self.assertIsNone(loader.positive_int(0))
        self.assertEqual(loader.positive_int("17.0"), 17)

    def test_preserves_athlete_ids_and_namespaces_lineup_fallbacks(self) -> None:
        self.assertEqual(
            loader.source_player_id({"athlete_id": "123", "lineup_member_id": "456"}),
            "123",
        )
        self.assertEqual(
            loader.source_player_id({"athlete_id": "", "lineup_member_id": "123"}),
            "lineup:123",
        )
        self.assertNotEqual(
            loader.source_player_id({"athlete_id": "123", "lineup_member_id": "456"}),
            loader.source_player_id({"athlete_id": "", "lineup_member_id": "123"}),
        )

    def test_namespaces_legacy_lineup_only_shot_ids(self) -> None:
        self.assertEqual(
            loader.shot_player_source_id(
                {"player_source_id": "456", "lineup_member_id": "456"}
            ),
            "lineup:456",
        )
        self.assertEqual(
            loader.shot_player_source_id(
                {
                    "athlete_id": "123",
                    "player_source_id": "123",
                    "lineup_member_id": "456",
                }
            ),
            "123",
        )
        self.assertEqual(
            loader.shot_player_source_id(
                {"player_source_id": "123", "lineup_member_id": "456"}
            ),
            "123",
        )

    def test_same_batch_lineup_identity_follows_one_exact_athlete(self) -> None:
        rows = [
            player_row("lineup:456", "José  O'Neil", "team-a"),
            player_row("123", "Jose ONeil", "team-a"),
        ]

        resolved, representatives = loader.plan_player_identity_resolution(rows, {}, [])

        self.assertEqual(resolved, {})
        self.assertEqual(representatives["lineup:456"], "123")
        self.assertEqual(representatives["123"], "123")

    def test_same_batch_lineup_only_ids_share_one_representative(self) -> None:
        rows = [
            player_row("lineup:456", "Exact Name", "team-a", "match-a"),
            player_row("lineup:789", "Exact Name", "team-a", "match-b"),
        ]

        resolved, representatives = loader.plan_player_identity_resolution(rows, {}, [])

        self.assertEqual(resolved, {})
        self.assertEqual(representatives["lineup:456"], "lineup:456")
        self.assertEqual(representatives["lineup:789"], "lineup:456")

    def test_same_name_teammates_in_one_match_are_not_reconciled(self) -> None:
        rows = [
            player_row("lineup:456", "Shared Name", "team-a", "match-a"),
            player_row("lineup:789", "Shared Name", "team-a", "match-a"),
        ]

        resolved, representatives = loader.plan_player_identity_resolution(rows, {}, [])

        self.assertEqual(resolved, {})
        self.assertEqual(representatives["lineup:456"], "lineup:456")
        self.assertEqual(representatives["lineup:789"], "lineup:789")

    def test_same_match_exact_lineup_split_follows_one_athlete(self) -> None:
        rows = [
            player_row(
                "123",
                "Exact Name",
                "team-a",
                "match-a",
                jersey_number=17,
                lineup_status="Starting XI",
                minutes="90",
                position="Left Back",
                formation="Defender",
            ),
            player_row(
                "lineup:456",
                "Exact Name",
                "team-a",
                "match-a",
                jersey_number="17.0",
                lineup_status=" starting-xi ",
                minutes=90.0,
                position="left-back",
                formation=None,
            ),
        ]

        resolved, representatives = loader.plan_player_identity_resolution(rows, {}, [])

        self.assertEqual(resolved, {})
        self.assertEqual(representatives["lineup:456"], "123")
        self.assertEqual(representatives["123"], "123")

    def test_same_match_exact_lineup_split_reuses_existing_canonical(self) -> None:
        rows = [
            player_row(
                "123",
                "Exact Name",
                "team-a",
                "match-a",
                jersey_number=17,
                lineup_status="Starter",
                minutes=75,
            ),
            player_row(
                "lineup:456",
                "Exact Name",
                "team-a",
                "match-a",
                jersey_number=17,
                lineup_status="starter",
                minutes="75.0",
            ),
        ]
        candidates = [
            candidate(
                "canonical-player",
                "lineup:456",
                "Exact Name",
                "team-a",
                is_lineup_fallback=True,
            )
        ]

        resolved, _ = loader.plan_player_identity_resolution(
            rows,
            {"lineup:456": "canonical-player"},
            candidates,
        )

        self.assertEqual(resolved["123"], "canonical-player")
        self.assertEqual(resolved["lineup:456"], "canonical-player")

    def test_same_match_exact_lineup_split_follows_mapped_athlete(self) -> None:
        rows = [
            player_row(
                "123",
                "Exact Name",
                "team-a",
                "match-a",
                jersey_number=17,
                lineup_status="Starter",
                minutes=75,
            ),
            player_row(
                "lineup:456",
                "Exact Name",
                "team-a",
                "match-a",
                jersey_number=17,
                lineup_status="starter",
                minutes="75.0",
            ),
        ]
        candidates = [
            candidate(
                "canonical-player",
                "123",
                "Exact Name",
                "team-a",
                is_lineup_fallback=False,
            )
        ]

        resolved, _ = loader.plan_player_identity_resolution(
            rows,
            {"123": "canonical-player"},
            candidates,
        )

        self.assertEqual(resolved["123"], "canonical-player")
        self.assertEqual(resolved["lineup:456"], "canonical-player")

    def test_same_match_weak_or_conflicting_evidence_stays_ambiguous(self) -> None:
        exact_athlete = player_row(
            "123",
            "Shared Name",
            "team-a",
            "match-a",
            jersey_number=17,
            lineup_status="Starter",
            minutes=90,
            position="Defender",
            formation="Left Back",
        )
        conflicting_fields = (
            ("missing jersey", {"jersey_number": None}),
            ("different jersey", {"jersey_number": 18}),
            ("different status", {"lineup_status": "Substitute"}),
            ("different minutes", {"minutes": 89}),
            ("different position", {"position": "Forward"}),
            ("different formation", {"formation": "Right Back"}),
        )

        for label, overrides in conflicting_fields:
            with self.subTest(label=label):
                lineup_values = {
                    "jersey_number": 17,
                    "lineup_status": "starter",
                    "minutes": "90.0",
                    "position": "defender",
                    "formation": "left-back",
                    **overrides,
                }
                rows = [
                    exact_athlete,
                    player_row(
                        "lineup:456",
                        "Shared Name",
                        "team-a",
                        "match-a",
                        **lineup_values,
                    ),
                ]

                resolved, representatives = loader.plan_player_identity_resolution(
                    rows,
                    {},
                    [],
                )

                self.assertEqual(resolved, {})
                self.assertEqual(representatives["lineup:456"], "lineup:456")

    def test_same_match_two_athletes_stay_ambiguous_even_with_exact_evidence(self) -> None:
        shared = {
            "jersey_number": 17,
            "lineup_status": "Starter",
            "minutes": 90,
        }
        rows = [
            player_row("111", "Shared Name", "team-a", "match-a", **shared),
            player_row("222", "Shared Name", "team-a", "match-a", **shared),
            player_row("lineup:456", "Shared Name", "team-a", "match-a", **shared),
        ]

        resolved, representatives = loader.plan_player_identity_resolution(rows, {}, [])

        self.assertEqual(resolved, {})
        self.assertEqual(representatives["lineup:456"], "lineup:456")

    def test_every_same_match_lineup_fallback_requires_exact_evidence(self) -> None:
        shared = {
            "jersey_number": 17,
            "lineup_status": "Starter",
            "minutes": 90,
        }
        rows = [
            player_row("123", "Shared Name", "team-a", "match-a", **shared),
            player_row("lineup:456", "Shared Name", "team-a", "match-a", **shared),
            player_row(
                "lineup:789",
                "Shared Name",
                "team-a",
                "match-a",
                **{**shared, "minutes": 12},
            ),
        ]

        resolved, representatives = loader.plan_player_identity_resolution(rows, {}, [])

        self.assertEqual(resolved, {})
        self.assertEqual(representatives["lineup:456"], "lineup:456")
        self.assertEqual(representatives["lineup:789"], "lineup:789")

    def test_later_athlete_identity_reuses_one_lineup_canonical(self) -> None:
        rows = [player_row("123", "Exact Name", "team-a")]
        existing = {"lineup:456": "canonical-player"}
        candidates = [
            candidate("canonical-player", "lineup:456", "Exact Name", "team-a")
        ]

        resolved, _ = loader.plan_player_identity_resolution(rows, existing, candidates)

        self.assertEqual(resolved["123"], "canonical-player")

    def test_legacy_untyped_mapping_blocks_athlete_reconciliation(self) -> None:
        rows = [player_row("123", "Exact Name", "team-a")]
        candidates = [
            candidate("canonical-player", "456", "Exact Name", "team-a")
        ]

        resolved, _ = loader.plan_player_identity_resolution(rows, {}, candidates)

        self.assertNotIn("123", resolved)

    def test_legacy_untyped_mapping_can_still_receive_a_lineup_alias(self) -> None:
        rows = [player_row("lineup:123", "Exact Name", "team-a")]
        candidates = [
            candidate("canonical-player", "456", "Exact Name", "team-a")
        ]

        resolved, _ = loader.plan_player_identity_resolution(rows, {}, candidates)

        self.assertEqual(resolved["lineup:123"], "canonical-player")

    def test_lineup_alias_can_follow_one_canonical_with_multiple_legacy_ids(self) -> None:
        rows = [player_row("lineup:123", "Exact Name", "team-a")]
        candidates = [
            candidate("canonical-player", "456", "Exact Name", "team-a"),
            candidate("canonical-player", "789", "Exact Name", "team-a"),
        ]

        resolved, _ = loader.plan_player_identity_resolution(rows, {}, candidates)

        self.assertEqual(resolved["lineup:123"], "canonical-player")

    def test_known_different_athlete_prevents_athlete_reconciliation(self) -> None:
        rows = [player_row("123", "Exact Name", "team-a")]
        candidates = [
            candidate(
                "canonical-player",
                "456",
                "Exact Name",
                "team-a",
                is_lineup_fallback=False,
            )
        ]

        resolved, _ = loader.plan_player_identity_resolution(rows, {}, candidates)

        self.assertNotIn("123", resolved)

    def test_does_not_reconcile_across_teams_or_similar_names(self) -> None:
        rows = [player_row("123", "Roy Navi", "team-a")]
        existing = {"lineup:456": "other-player"}
        candidates = [
            candidate("other-player", "lineup:456", "Roy Navi", "team-b"),
            candidate("similar-player", "lineup:789", "Roy Nawi", "team-a"),
        ]

        resolved, representatives = loader.plan_player_identity_resolution(
            rows,
            existing,
            candidates,
        )

        self.assertNotIn("123", resolved)
        self.assertEqual(representatives["123"], "123")

    def test_leaves_ambiguous_candidates_and_athlete_ids_separate(self) -> None:
        fallback_rows = [player_row("lineup:456", "Shared Name", "team-a")]
        candidates = [
            candidate("player-one", "111", "Shared Name", "team-a"),
            candidate("player-two", "222", "Shared Name", "team-a"),
        ]
        resolved, representatives = loader.plan_player_identity_resolution(
            fallback_rows,
            {},
            candidates,
        )
        self.assertNotIn("lineup:456", resolved)
        self.assertEqual(representatives["lineup:456"], "lineup:456")

        multi_athlete_rows = [
            player_row("111", "Shared Name", "team-a"),
            player_row("222", "Shared Name", "team-a"),
            player_row("lineup:456", "Shared Name", "team-a"),
        ]
        _, representatives = loader.plan_player_identity_resolution(
            multi_athlete_rows,
            {},
            [],
        )
        self.assertEqual(representatives["lineup:456"], "lineup:456")

        resolved, _ = loader.plan_player_identity_resolution(
            multi_athlete_rows,
            {"111": "player-one"},
            [candidate("player-one", "111", "Shared Name", "team-a")],
        )
        self.assertNotIn("lineup:456", resolved)

    def test_database_candidates_are_team_and_season_name_scoped(self) -> None:
        source = inspect.getsource(loader.ensure_players)

        self.assertIn("pma.team_id = any(%s)", source)
        self.assertIn("candidate_match.season_id", source)
        self.assertIn("candidate_season.name", source)
        self.assertIn("selected_season.name", source)

    def test_legacy_observation_cleanup_requires_same_appearance_and_player(self) -> None:
        source = inspect.getsource(loader.ensure_appearances)

        self.assertIn("delete from obs.player_appearance_observations legacy", source)
        self.assertIn("legacy.appearance_id = fresh.appearance_id", source)
        self.assertIn("legacy.player_id = fresh.player_id", source)
        self.assertIn("legacy.source_player_id = substring", source)
        self.assertIn("legacy.id <> fresh.id", source)


if __name__ == "__main__":
    unittest.main()
