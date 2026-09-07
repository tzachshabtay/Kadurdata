import assert from "node:assert/strict";
import test from "node:test";
import { filterLegionnaireHistory, assertWeeklyEligibility } from "../scripts/legionnaire_eligibility.mjs";

const competitions = [
  { competition_id: "bg", scope: "foreign_club", name: "Bulgarian league" },
  { competition_id: "il", scope: "domestic", name: "Israeli league" },
  { competition_id: "nt", scope: "national_team", name: "National teams" },
];
const seasons = [
  { season_id: "bg26", competition_id: "bg", season_name: "2026/2027" },
  { season_id: "bg25", competition_id: "bg", season_name: "2025/2026" },
  { season_id: "il26", competition_id: "il", season_name: "2026/2027" },
  { season_id: "nt26", competition_id: "nt", season_name: "2026/2027" },
];
const row = (match_id, season_id, competition_id) => ({ player_id: "returning-player", match_id, season_id, competition_id, team_name: match_id });

test("returning legionnaire keeps foreign appearance but not domestic game or baseline", () => {
  const input = [row("old-club", "bg26", "bg"), row("new-israeli-club", "il26", "il"),
    row("new-israeli-club", "il26", "il"), row("previous-season", "bg25", "bg"), row("national-team", "nt26", "nt")];
  const result = filterLegionnaireHistory(input, seasons, competitions, "2026/2027");
  assert.deepEqual(result.rows.map((r) => r.match_id), ["old-club"]);
  assert.equal(result.rows[0].competition_scope, "foreign_club");
  assert.deepEqual(result.excludedAppearances.map((r) => r.reason), ["not_foreign_club", "different_season", "not_foreign_club"]);
});

test("unknown or contradictory competition metadata fails closed", () => {
  const result = filterLegionnaireHistory([row("unknown", "missing", "bg"), row("mismatch", "il26", "bg")], seasons, competitions, "2026/2027");
  assert.equal(result.rows.length, 0);
  assert.equal(result.excludedAppearances.length, 2);
});

test("publication rejects stale candidates and domestic or wrong-season appearances", () => {
  const article = (match) => ({ kind: "legionnaire_weekly", period: { seasonName: "2026/2027" }, summary: { players: [{ nameHe: "שחקן", matches: [match] }] } });
  const valid = { matchId: "m", seasonId: "bg26", competitionId: "bg", competitionScope: "foreign_club", seasonName: "2026/2027" };
  assert.doesNotThrow(() => assertWeeklyEligibility(article(valid)));
  assert.throws(() => assertWeeklyEligibility(article({ matchId: "legacy" })), /not a verified/);
  assert.throws(() => assertWeeklyEligibility(article({ ...valid, competitionScope: "domestic" })), /not a verified/);
  assert.throws(() => assertWeeklyEligibility(article({ ...valid, seasonName: "2025/2026" })), /not a verified/);
  assert.throws(() => assertWeeklyEligibility({ ...article(valid), period: {} }), /missing reporting season/);
  assert.throws(() => assertWeeklyEligibility(article({ ...valid, matchId: undefined })), /not a verified/);
  assert.doesNotThrow(() => assertWeeklyEligibility({ kind: "match_review" }));
});
