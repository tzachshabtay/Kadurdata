import assert from "node:assert/strict";
import test from "node:test";
import { shotsOnTargetSummary, verifiedGoalLineBlock } from "../scripts/content_shot_reconciliation.mjs";

const clearance = {
  match_id: "76e6c0e6-9d63-4813-89a7-772b01b142c7",
  source_code: "365scores",
  source_event_id: "194739340",
  team_id: "af106a7f-f0a9-4db3-88d7-bd04ebbfb100",
  player_id: "713ec20b-f06b-4502-85cf-ba2ba0d9c770",
  minute: 65,
  outcome: "Blocked",
  goal_mouth_x: 98.4,
  goal_mouth_y: 48,
};

test("counts the independently documented goal-line clearance without changing its outcome", () => {
  const shots = [clearance, { ...clearance, source_event_id: "goal", outcome: "Goal" }, { ...clearance, source_event_id: "save", outcome: "Saved" }];
  const before = structuredClone(shots);
  const summary = shotsOnTargetSummary(shots, clearance.team_id);
  assert.equal(summary.count, 3);
  assert.equal(summary.goalsAndSaves, 2);
  assert.equal(summary.goalLineBlocks.length, 1);
  assert.match(summary.goalLineBlocks[0].sourceUrl, /^https:\/\/www\.maccabi-tlv\.co\.il\//);
  assert.deepEqual(shots, before);
});

test("does not infer an on-target block from a nearby coordinate or another event", () => {
  const unknown = { ...clearance, source_event_id: "unverified" };
  assert.equal(verifiedGoalLineBlock(unknown), null);
  assert.equal(shotsOnTargetSummary([unknown], clearance.team_id).count, 0);
});

test("requires the exact match, provider, team, player and minute", () => {
  for (const key of ["match_id", "source_code", "source_event_id", "team_id", "player_id", "minute"]) {
    assert.equal(verifiedGoalLineBlock({ ...clearance, [key]: "different" }), null, key);
  }
  assert.equal(shotsOnTargetSummary([clearance], "other-team").count, 0);
});

test("does not double count a provider event later reclassified as Saved", () => {
  const summary = shotsOnTargetSummary([{ ...clearance, outcome: "Saved" }], clearance.team_id);
  assert.equal(summary.count, 1);
  assert.equal(summary.goalLineBlocks.length, 0);
});

test("leaves ordinary goals, saves, misses, posts and blocks unchanged", () => {
  const outcomes = ["Goal", "Saved", "Missed", "Post", "Blocked"];
  const shots = outcomes.map((outcome) => ({ team_id: "team", outcome }));
  assert.equal(shotsOnTargetSummary(shots, "team").count, 2);
});

const peretzClearance = {
  match_id: "b627585d-b1d3-4b29-b4a1-b428e623cda7",
  source_code: "365scores",
  source_event_id: "54739320",
  team_id: "af106a7f-f0a9-4db3-88d7-bd04ebbfb100",
  player_id: "b6a41010-aafc-4cdc-983e-8e64d0dd852c",
  minute: 20,
  outcome: "Blocked",
};

test("reconciles Sakhnin's documented goal-line clearance with five goalkeeper saves", () => {
  const shots = [peretzClearance, ...Array.from({ length: 5 }, (_, index) => ({ ...peretzClearance, source_event_id: `save-${index}`, outcome: "Saved" }))];
  const before = structuredClone(shots);
  const summary = shotsOnTargetSummary(shots, peretzClearance.team_id);
  assert.equal(summary.count, 6);
  assert.equal(summary.goalsAndSaves, 5);
  assert.equal(summary.goalLineBlocks.length, 1);
  assert.equal(summary.goalLineBlocks[0].sourceEventId, "54739320");
  assert.match(summary.goalLineBlocks[0].sourceUrl, /2026\/10\//);
  assert.deepEqual(shots, before);
});

test("requires the exact Peretz clearance identity and avoids counting a later save twice", () => {
  for (const key of ["match_id", "source_code", "source_event_id", "team_id", "player_id", "minute"]) {
    assert.equal(verifiedGoalLineBlock({ ...peretzClearance, [key]: "different" }), null, key);
  }
  assert.equal(shotsOnTargetSummary([peretzClearance], "other-team").count, 0);
  const reclassified = shotsOnTargetSummary([{ ...peretzClearance, outcome: "Saved" }], peretzClearance.team_id);
  assert.equal(reclassified.count, 1);
  assert.equal(reclassified.goalLineBlocks.length, 0);
});
