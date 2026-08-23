import inspect
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

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


class SeasonLoadingTests(unittest.TestCase):
    @patch.object(loader, "upsert_mapping")
    @patch.object(loader, "execute_one", return_value={"id": "canonical-season"})
    @patch.object(loader, "get_mapping", return_value="mapped-season")
    def test_existing_canonical_season_replaces_conflicting_mapping(
        self,
        get_mapping: Mock,
        execute_one: Mock,
        upsert_mapping: Mock,
    ) -> None:
        cursor = Mock()

        season_id = loader.get_or_create_season(
            cursor,
            "source-id",
            "competition-id",
            "competition-source-id",
            [{"season_num": "2026", "start_time": "2026-08-01T18:00:00Z"}],
            {"name": "2026/2027", "is_current": True},
        )

        self.assertEqual(season_id, "canonical-season")
        get_mapping.assert_called_once_with(
            cursor,
            "source-id",
            "season",
            "competition-source-id:2026",
        )
        self.assertEqual(
            execute_one.call_args.args[2],
            ("competition-id", "2026/2027", "mapped-season"),
        )
        self.assertEqual(cursor.execute.call_args.args[1][-1], "canonical-season")
        self.assertEqual(upsert_mapping.call_args.args[5], "canonical-season")

    def test_wide_stat_refresh_preserves_metrics_omitted_by_partial_payloads(self) -> None:
        source = inspect.getsource(loader.flush_wide_stat_batch)

        self.assertIn("coalesce(excluded.{}, current_stats.{})", source)
        self.assertIn("insert into {} as current_stats", source)
        self.assertNotIn('sql.SQL("{} = excluded.{}")', source)


if __name__ == "__main__":
    unittest.main()
