"""Regressions for duplicate appearances and corrected fixture participants."""
import contextlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import psycopg
from psycopg.rows import dict_row
import load_365scores_to_supabase as loader


def played_row(**changes):
    return {
        "game_id": "4739330", "athlete_id": "88692", "team_id": "606",
        "opponent_id": "614", "team_side": "home", "player_name": "Ron Unger",
        "lineup_member_id": "56097091", "jersey_number": "17",
        "lineup_status_text": "Starting", "has_stats": "True",
        "stat_minutes_value": "86.0", "stat_total_shots_value": "1.0",
        "rating": "6.5", "heatmap_url": "https://example.test/heatmap",
        **changes,
    }


def missing_row():
    row = played_row(lineup_member_id="79291504", jersey_number="-1",
                     lineup_status_text="Missing", has_stats="False", rating="",
                     heatmap_url="", stat_minutes_value="", stat_total_shots_value="")
    return row


class DuplicateAppearanceTests(unittest.TestCase):
    def test_observed_starter_and_empty_missing_keep_played_record_in_either_order(self):
        active, missing = played_row(), missing_row()
        for rows in [[active, missing], [missing, active]]:
            with self.subTest(rows=rows):
                self.assertEqual(loader.deduplicate_player_rows(rows), [active])

    def test_exact_duplicate_does_not_double_stats(self):
        row = played_row()
        self.assertEqual(loader.deduplicate_player_rows([row, dict(row)]), [row])

    def test_conflicting_played_records_are_not_guessed_or_summed(self):
        with self.assertRaisesRegex(ValueError, "conflicting player appearance"):
            loader.deduplicate_player_rows([played_row(), played_row(stat_total_shots_value="2")])

    def test_missing_record_with_statistics_is_not_silently_discarded(self):
        row = missing_row()
        row["stat_total_shots_value"] = "0"
        with self.assertRaises(ValueError):
            loader.deduplicate_player_rows([played_row(), row])

    def test_separate_teams_matches_and_fallback_ids_remain_distinct(self):
        rows = [played_row(), played_row(game_id="other"), played_row(team_id="other"),
                played_row(athlete_id="", lineup_member_id="123"),
                played_row(athlete_id="", lineup_member_id="456")]
        self.assertEqual(loader.deduplicate_player_rows(rows), rows)


class CompetitionIsolationTests(unittest.TestCase):
    def test_failed_competition_does_not_starve_next_and_exit_stays_failed(self):
        fixtures = [
            {"competition_id": "8248", "season_num": "3", "game_id": "bad"},
            {"competition_id": "42", "season_num": "89", "game_id": "good"},
        ]
        competitions = {"8248": {"name": "Division 3"}, "42": {"name": "Israeli Premier League"}}
        conn = MagicMock()
        conn.__enter__.return_value = conn
        fixture_loader = MagicMock(side_effect=[ValueError("unsafe correction"), {"matches": {"good": "id"}}])
        with tempfile.TemporaryDirectory() as tmp, contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {"SUPABASE_DB_URL": "unused-test-only"}))
            stack.enter_context(patch.object(loader, "parse_args", return_value=SimpleNamespace(processed_dir=Path(tmp))))
            stack.enter_context(patch.object(loader, "read_csv", side_effect=lambda path: fixtures if path.name == "365scores_fixtures.csv" else []))
            stack.enter_context(patch.object(loader, "read_manifest", return_value={}))
            stack.enter_context(patch.object(loader, "manifest_competitions", return_value=competitions))
            stack.enter_context(patch.object(loader.psycopg, "connect", return_value=conn))
            for name in ["get_source", "get_or_create_country", "get_or_create_competition", "get_or_create_season"]:
                stack.enter_context(patch.object(loader, name, return_value="id"))
            stack.enter_context(patch.object(loader, "load_fixtures", fixture_loader))
            players = stack.enter_context(patch.object(loader, "load_player_rows"))
            stack.enter_context(patch.object(loader, "load_shot_events", return_value=0))
            team_stats = stack.enter_context(patch.object(loader, "load_team_stats"))
            log = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            self.assertEqual(loader.main(), 1)
            self.assertEqual(fixture_loader.call_count, 2)
            players.assert_called_once()
            team_stats.assert_called_once()
            conn.rollback.assert_called_once()
            self.assertIn("unsafe correction", log.getvalue())
            self.assertIn("load incomplete", log.getvalue())


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "requires disposable PostgreSQL database")
class RefreshPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.conn = psycopg.connect(os.environ["TEST_DATABASE_URL"], row_factory=dict_row)
        with cls.conn.cursor() as cur:
            cur.execute("select current_database() as name")
            if cur.fetchone()["name"] != "kadurdata_test":
                raise RuntimeError("Integration tests require the disposable kadurdata_test database")
            # Real schema/constraints, plus the two wide-stat tables introduced in023.
            root = Path(__file__).resolve().parents[1]
            cur.execute((root / "db/migrations/001_initial_schema.sql").read_text())
            wide = (root / "db/migrations/023_wide_match_stats.sql").read_text()
            cur.execute(wide[:wide.index("do $migration$")])
        cls.conn.commit()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.tx = self.conn.transaction(force_rollback=True)
        self.tx.__enter__()
        self.cur = self.conn.cursor()
        self.cur.execute("insert into core.competitions (name,competition_type) values ('Test','league') returning id")
        competition = self.cur.fetchone()["id"]
        self.cur.execute("insert into core.seasons (competition_id,name) values (%s,'2026/2027') returning id", (competition,))
        self.season = self.cur.fetchone()["id"]
        self.teams = []
        for name in ["Home", "Away", "Replacement"]:
            self.cur.execute("insert into core.teams (name) values (%s) returning id", (name,))
            self.teams.append(self.cur.fetchone()["id"])
        self.home, self.away, self.replacement = self.teams
        self.cur.execute("insert into core.matches (season_id,home_team_id,away_team_id) values (%s,%s,%s) returning id", (self.season,self.home,self.away))
        self.match = self.cur.fetchone()["id"]
        self.home_row = loader.upsert_match_team(self.cur,self.match,self.home,self.away,"home",None)
        self.away_row = loader.upsert_match_team(self.cur,self.match,self.away,self.home,"away",None)
        self.source = loader.get_source(self.cur)
        self.country = loader.get_or_create_country(self.cur)

    def tearDown(self):
        self.cur.close()
        self.tx.__exit__(None, None, None)

    def fixture(self, home, away):
        # Equivalent parent update/lock from upsert_match, in the same transaction.
        self.cur.execute("update core.matches set home_team_id=%s,away_team_id=%s where id=%s", (home,away,self.match))
        loader.reconcile_match_teams(self.cur,self.match,home,away)
        loader.upsert_match_team(self.cur,self.match,home,away,"home",1)
        loader.upsert_match_team(self.cur,self.match,away,home,"away",0)

    def test_fixture_only_replacement_and_repeat_succeed_without_moving_ids(self):
        self.fixture(self.replacement,self.away)
        self.fixture(self.replacement,self.away)
        self.cur.execute("select id,team_id,side,opponent_team_id from core.match_teams where match_id=%s", (self.match,))
        rows = {r["team_id"]: r for r in self.cur.fetchall()}
        self.assertEqual(set(rows), {self.replacement,self.away})
        self.assertEqual(rows[self.away]["id"], self.away_row)
        self.assertEqual(rows[self.replacement]["side"], "home")
        self.assertEqual(rows[self.away]["opponent_team_id"], self.replacement)

    def test_side_swap_preserves_stat_identity_and_updates_appearance_context(self):
        self.cur.execute("insert into obs.team_match_stats (source_id,match_team_id,metric_count) values (%s,%s,1)", (self.source,self.home_row))
        self.cur.execute("insert into core.players (display_name) values ('Test') returning id")
        player = self.cur.fetchone()["id"]
        self.cur.execute("insert into core.player_match_appearances (match_id,player_id,team_id,opponent_team_id,side) values (%s,%s,%s,%s,'home')", (self.match,player,self.home,self.away))
        self.fixture(self.away,self.home)
        self.fixture(self.away,self.home)
        self.cur.execute("select team.team_id,team.side from obs.team_match_stats stats join core.match_teams team on team.id=stats.match_team_id")
        self.assertEqual(self.cur.fetchone(), {"team_id":self.home,"side":"away"})
        self.cur.execute("select side,opponent_team_id from core.player_match_appearances where match_id=%s", (self.match,))
        self.assertEqual(self.cur.fetchone(), {"side":"away","opponent_team_id":self.away})

    def test_replacement_with_stats_rolls_back_fixture_and_preserves_details(self):
        self.cur.execute("insert into obs.team_match_stats (source_id,match_team_id,metric_count) values (%s,%s,1)", (self.source,self.home_row))
        with self.assertRaisesRegex(ValueError, "recorded match details"):
            with self.conn.transaction():
                self.fixture(self.replacement,self.away)
        self.cur.execute("select home_team_id from core.matches where id=%s", (self.match,))
        self.assertEqual(self.cur.fetchone()["home_team_id"],self.home)
        self.cur.execute("select match_team_id from obs.team_match_stats")
        self.assertEqual(self.cur.fetchone()["match_team_id"],self.home_row)

    def test_replacement_with_appearance_or_legacy_stat_is_rejected(self):
        self.cur.execute("insert into core.players (display_name) values ('Test') returning id")
        player = self.cur.fetchone()["id"]
        self.cur.execute("insert into core.player_match_appearances (match_id,player_id,team_id) values (%s,%s,%s)", (self.match,player,self.home))
        with self.assertRaises(ValueError):
            with self.conn.transaction():
                self.fixture(self.replacement,self.away)

    def test_duplicate_source_rows_load_once_and_preserve_minutes_stats_and_heatmap(self):
        indexes = {"matches":{"4739330":self.match},"teams":{"606":self.home,"614":self.away}}
        for rows in [[played_row(),missing_row()], [missing_row(),played_row()]]:
            loader.load_player_rows(self.conn,self.cur,self.source,self.country,self.season,rows,indexes)
        self.cur.execute("select minutes_played,shirt_number,lineup_status from core.player_match_appearances where match_id=%s", (self.match,))
        rows = self.cur.fetchall()
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["minutes_played"],86)
        self.assertEqual(rows[0]["shirt_number"],17)
        self.assertEqual(rows[0]["lineup_status"],"Starting")
        self.cur.execute("select total_shots from obs.player_match_stats")
        self.assertEqual(self.cur.fetchone()["total_shots"],1)
        self.cur.execute("select heatmap_url from obs.player_appearance_observations")
        self.assertEqual(self.cur.fetchone()["heatmap_url"],played_row()["heatmap_url"])


if __name__ == "__main__":
    unittest.main()
