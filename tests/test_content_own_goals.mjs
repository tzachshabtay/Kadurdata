import assert from "node:assert/strict";
import test from "node:test";
import { isOwnGoal, shootingAttempts, goalsForTeam, storedGoalErrors } from "../scripts/content_goal_events.mjs";
import { buildFlowWindows, normalizeTimelineEvents, providerComparableTeamXg } from "../scripts/generate_content_article.mjs";
import { buildGameStateContext } from "../scripts/content_analysis.mjs";
import { shotsOnTargetSummary } from "../scripts/content_shot_reconciliation.mjs";

// Captured identities and semantics of the provider's Grimberg own goal.
const ownGoal = { source_event_id: "254739302", team_id: "haifa", player_id: "grimberg", minute: 82, outcome: "Goal", situation: "Own Goal", xg: null, xgot: null };
const goal = (team_id, player_id, minute) => ({ team_id, player_id, minute, outcome: "Goal", situation: "Assisted", xg: .1 });
const events = [goal("bs", "zlatanovic", 50), goal("bs", "diop", 54), goal("bs", "zlatanovic", 56), goal("haifa", "grimberg", 77), goal("bs", "amankwah", 79), ownGoal, goal("haifa", "grimberg", 90)];
const home = { teamId: "haifa", nameHe: "מכבי חיפה", score: 2, stats: {} };
const away = { teamId: "bs", nameHe: "הפועל באר שבע", score: 5, stats: {} };
const provider = { homeCompetitor: { id: 4 }, events: [{ competitorId: 579, gameTime: 82, gameTimeDisplay: "82'", eventType: { id: 1, name: "Goal", subTypeName: "Own Goal" } }] };

test("an explicit own goal changes the opponent's score without inventing an attempt or personal goal", () => {
  const original = structuredClone(events);
  assert.equal(shootingAttempts(events).length, 6);
  assert.equal(shootingAttempts(events).filter(s => s.player_id === "grimberg").length, 2);
  assert.equal(goalsForTeam(events, "haifa", "bs"), 2);
  assert.equal(goalsForTeam(events, "bs", "haifa"), 5);
  assert.equal(shotsOnTargetSummary(events, "haifa").count, 2);
  assert.equal(providerComparableTeamXg(events, "haifa"), .2);
  assert.deepEqual(events, original);
});

test("unknown goals and zero-xG goals are not inferred to be own goals", () => {
  assert.equal(isOwnGoal({ ...ownGoal, situation: "Regular Play", xg: 0 }), false);
  assert.equal(isOwnGoal({ ...ownGoal, situation: undefined }), false);
  assert.equal(isOwnGoal({ ...ownGoal, outcome: "Missed" }), false);
  assert.equal(goalsForTeam([{ ...ownGoal, situation: "Regular Play" }], "haifa", "bs"), 1);
});

test("flow and late game-state windows credit own goals to the correct team while excluding them from shot volume", () => {
  const windows = buildFlowWindows(events, "haifa", "bs");
  assert.deepEqual(windows.at(-1).home, { shots: 2, xg: .2, goals: 2 });
  assert.deepEqual(windows.at(-1).away, { shots: 1, xg: .1, goals: 2 });
  const context = buildGameStateContext(events, [], home, away);
  assert.equal(context.totals.home.goals, 2);
  assert.equal(context.totals.away.goals, 5);
  assert.equal(context.lateWindow.home.shots, 2);
  assert.equal(context.lateWindow.away.goals, 2);
});

test("provider own-goal subtype survives normalization with the beneficiary team", () => {
  const normalized = normalizeTimelineEvents(provider, [], home, away);
  assert.equal(normalized[0].ownGoal, true);
  assert.equal(normalized[0].teamId, "bs");
  assert.equal(normalized[0].type, "Goal");
  const ordinary = normalizeTimelineEvents({ ...provider, events: [{ ...provider.events[0], eventType: { name: "Goal" } }] }, [], home, away);
  assert.equal(ordinary[0].ownGoal, undefined);
});

test("stored validation reconciles all seven goals and still rejects corruption or missing own-goal evidence", () => {
  const article = {
    teams: { home, away },
    shots: shootingAttempts(events).map(s => ({ ...s, teamId: s.team_id })),
    timelineEvents: events.map(s => ({ type: "Goal", teamId: isOwnGoal(s) ? "bs" : s.team_id, minute: s.minute, playerNameHe: s.player_id, ...(isOwnGoal(s) ? { ownGoal: true } : {}) })),
    evidence: [{ id: "timeline.goals", context: { ownGoals: [{ teamId: "bs", minute: 82, playerNameHe: "grimberg" }] } }],
  };
  assert.deepEqual(storedGoalErrors(article), []);
  const wrongTeam = structuredClone(article); wrongTeam.timelineEvents[5].teamId = "haifa";
  assert(storedGoalErrors(wrongTeam).some(e => e.includes("timeline events")));
  const missingFlag = structuredClone(article); delete missingFlag.timelineEvents[5].ownGoal;
  assert(storedGoalErrors(missingFlag).some(e => e.includes("shot events")));
  const missingEvidence = structuredClone(article); missingEvidence.evidence = [];
  assert(storedGoalErrors(missingEvidence).some(e => e.includes("raw-event evidence")));
  const duplicateAttempt = structuredClone(article); duplicateAttempt.shots.push({ ...ownGoal, teamId: "haifa" });
  assert(storedGoalErrors(duplicateAttempt).some(e => e.includes("shooting attempt")));
  const unknownTeam = structuredClone(article); unknownTeam.timelineEvents.push({ type: "Goal", teamId: "unknown", minute: 83 });
  assert(storedGoalErrors(unknownTeam).some(e => e.includes("unknown team")));
});
