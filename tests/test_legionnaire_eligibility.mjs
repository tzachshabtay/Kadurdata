import assert from "node:assert/strict";
import test from "node:test";
import { filterLegionnaireHistory, assertWeeklyEligibility } from "../scripts/legionnaire_eligibility.mjs";
import { rollingReportingWindow, isWithinReportingWindow, filterCompletedHistory } from "../scripts/legionnaire_reporting_window.mjs";

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

test("rolling week includes Sunday American fixtures after Israeli midnight and uses exact boundaries", () => {
  const period = rollingReportingWindow("2026-09-14T23:36:00Z");
  assert.equal(period.startAt, "2026-09-07T23:36:00.000Z");
  assert.equal(period.start, "2026-09-08");
  assert.equal(period.end, "2026-09-15");
  assert.equal(isWithinReportingWindow("2026-09-13T21:30:00Z", period), true); // Turgeman at Chicago
  assert.equal(isWithinReportingWindow(period.startAt, period), true);
  assert.equal(isWithinReportingWindow("2026-09-07T23:35:59.999Z", period), false);
  assert.equal(isWithinReportingWindow(period.endAt, period), false);
  assert.deepEqual(rollingReportingWindow("2026-09-15T02:36:00+03:00"), period);
  const dstWeek = rollingReportingWindow("2026-10-26T10:00:00Z");
  assert.equal(Date.parse(dstWeek.endAt) - Date.parse(dstWeek.startAt), 168 * 3600000);
  assert.throws(() => rollingReportingWindow("2026-09-14"), /explicit timezone/);
  assert.throws(() => rollingReportingWindow("2026-09-14T23:36:00"), /explicit timezone/);
});

test("unfinished, missing and mismatched match records cannot enter weekly or baseline data", () => {
  const scheduled_at = "2026-09-13T21:30:00Z";
  const rows = ["ended", "extra-time", "penalties", "live", "scheduled", "unknown", "wrong-time"].map((match_id) => ({ match_id, scheduled_at }));
  const result = filterCompletedHistory(rows, [
    { match_id: "ended", scheduled_at, status: "Ended" },
    { match_id: "extra-time", scheduled_at, status: "After ET" },
    { match_id: "penalties", scheduled_at, status: "After Penalties" },
    { match_id: "live", scheduled_at, status: "In Progress" },
    { match_id: "scheduled", scheduled_at, status: "Scheduled" },
    { match_id: "wrong-time", scheduled_at: "2026-09-06T21:30:00Z", status: "Ended" },
  ]);
  assert.deepEqual(result.rows.map((r) => [r.match_id, r.match_status]), [["ended", "Ended"], ["extra-time", "After ET"], ["penalties", "After Penalties"]]);
  assert.equal(result.excludedMatches.length, 4);
});

test("finalization/publication rejects out-of-window and unfinished rolling appearances", () => {
  const period = { ...rollingReportingWindow("2026-09-14T23:36:00Z"), seasonName: "2026/2027" };
  const match = { matchId: "chicago", seasonId: "bg26", competitionId: "bg", competitionScope: "foreign_club", seasonName: "2026/2027", scheduledAt: "2026-09-13T21:30:00Z", status: "Ended" };
  const article = { kind: "legionnaire_weekly", period, summary: { players: [{ nameHe: "דור תורג׳מן", matches: [match] }] } };
  assert.doesNotThrow(() => assertWeeklyEligibility(article));
  for (const status of ["After ET", "After Penalties"]) {
    assert.doesNotThrow(() => assertWeeklyEligibility({ ...article, summary: { players: [{ nameHe: "שחקן", matches: [{ ...match, status }] }] } }));
  }
  for (const invalid of [{ ...match, status: "In Progress" }, { ...match, status: undefined }, { ...match, scheduledAt: period.endAt }, { ...match, scheduledAt: "2026-09-07T19:30:00Z" }]) {
    assert.throws(() => assertWeeklyEligibility({ ...article, summary: { players: [{ nameHe: "שחקן", matches: [invalid] }] } }), /not a completed appearance/);
  }
  assert.throws(() => assertWeeklyEligibility({ ...article, period: { ...period, startAt: "2026-09-07T00:00:00Z" } }), /exactly 168 hours/);
});
