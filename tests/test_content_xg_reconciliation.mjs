import assert from "node:assert/strict";
import test from "node:test";
import { providerComparableTeamXg } from "../scripts/generate_content_article.mjs";

const teamId = "team-a";

test("sums ordinary shots, including independent shots in the same displayed minute", () => {
  const shots = [
    { team_id: teamId, event_time: "40'", situation: "Assisted", outcome: "Blocked", xg: 0.21 },
    { team_id: teamId, event_time: "40'", situation: "Regular Play", outcome: "Goal", xg: 0.68 },
    { team_id: teamId, event_time: "55'", situation: "Assisted", outcome: "Missed", xg: 0.09 },
  ];

  assert.equal(providerComparableTeamXg(shots, teamId), 0.98);
});

test("collapses a missed penalty and its same-time rebounds into one scoring probability", () => {
  const shots = [
    { team_id: teamId, event_time: "26'", situation: "Assisted", outcome: "Missed", xg: 0.09 },
    { team_id: teamId, event_time: "63'", situation: "Penalty", outcome: "Saved", xg: 0.79 },
    { team_id: teamId, event_time: "63'", situation: "Set Piece", outcome: "Post", xg: 0.63 },
    { team_id: teamId, event_time: "63'", situation: "Set Piece", outcome: "Saved", xg: 0.21 },
  ];

  assert.equal(providerComparableTeamXg(shots, teamId), 1.03);
});

test("does not collapse a scored penalty or shots from the other team", () => {
  const shots = [
    { team_id: teamId, event_time: "48'", situation: "Penalty", outcome: "Goal", xg: 0.79 },
    { team_id: teamId, event_time: "48'", situation: "Regular Play", outcome: "Missed", xg: 0.1 },
    { team_id: "team-b", event_time: "48'", situation: "Penalty", outcome: "Saved", xg: 0.79 },
    { team_id: "team-b", event_time: "48'", situation: "Set Piece", outcome: "Post", xg: 0.7 },
  ];

  assert.equal(providerComparableTeamXg(shots, teamId), 0.89);
});
