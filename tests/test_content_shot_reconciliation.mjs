import assert from "node:assert/strict";
import test from "node:test";
import { shotsOnTargetSummary, verifiedGoalLineBlock } from "../scripts/content_shot_reconciliation.mjs";
import { excludeVerifiedDuplicateShots, verifiedShotDuplicates, storedShotDuplicateErrors } from "../scripts/content_shot_duplicates.mjs";
import { shootingAttempts } from "../scripts/content_goal_events.mjs";
import { buildGameStateContext } from "../scripts/content_analysis.mjs";
import { buildFlowWindows, providerComparableTeamXg } from "../scripts/generate_content_article.mjs";

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

test("reconciles Carabali's 89th-minute clearance without changing the shot data", () => {
  const shot = { ...peretzClearance, match_id: "fe0a16ab-0cfc-40b3-9634-39733223c77e", source_event_id: "324739311", minute: 89 };
  const shots = [shot, ...Array.from({ length: 2 }, (_, index) => ({ ...shot, source_event_id: `save-${index}`, outcome: "Saved" }))];
  const before = structuredClone(shots), summary = shotsOnTargetSummary(shots, shot.team_id);
  assert.equal(summary.count, 3);
  assert.equal(summary.goalsAndSaves, 2);
  assert.equal(summary.goalLineBlocks[0].sourceUrl, "https://www.ynet.co.il/sport/israelisoccer/article/bkzrtkm2fe");
  assert.deepEqual(shots, before);
  for (const key of ["match_id", "source_code", "source_event_id", "team_id", "player_id", "minute"]) assert.equal(verifiedGoalLineBlock({ ...shot, [key]: "different" }), null);
  assert.equal(shotsOnTargetSummary([{ ...shot, outcome: "Saved" }], shot.team_id).count, 1);
});

const ansah = {
  match_id: "6f9fd23a-48b9-4547-9fae-adfdf0d9797b", source_code: "365scores",
  team_id: "9cc12c58-fc31-47e8-a7d6-0217b90a4cf3", player_id: "a9d814e8-0166-40a7-97b7-8a36ffa7ff6e",
  minute: 90, event_time: "90 + 6'", x: 72.7, y: 53, outcome: "Missed", body_part: "Right Foot",
  goal_mouth_x: null, goal_mouth_y: 37.8,
};
const ansahKept = { ...ansah, event_id: "kept", source_event_id: "264739306", situation: "Fast Break", xg: 0.04, xgot: 0 };
const ansahDuplicate = { ...ansah, event_id: "duplicate", source_event_id: "274739306", situation: "Regular Play", xg: 0.03, xgot: null };

test("reconciles only the verified paired Ansah observation across counts, xG and flow without mutating raw events", () => {
  const raw = [ansahKept, ansahDuplicate], before = structuredClone(raw);
  assert.deepEqual(shootingAttempts(raw), [ansahKept]);
  assert.deepEqual(raw, before);
  assert.equal(providerComparableTeamXg(raw, ansah.team_id), 0.04);
  const flow = buildFlowWindows(raw, "home", ansah.team_id, "Ended");
  assert.equal(flow.reduce((n, w) => n + w.away.shots, 0), 1);
  const state = buildGameStateContext(raw, [], { teamId: "home", stats: {} }, { teamId: ansah.team_id, stats: {} });
  assert.equal(state.totals.away.shots, 1);
  assert.equal(state.totals.away.expectedGoals, 0.04);
  assert.match(verifiedShotDuplicates(raw)[0].sourceUrl, /^https:\/\/www\.beitarfc\.co\.il\//);
});

test("requires every verified field on both records and exactly one complete pair", () => {
  for (const row of [0, 1]) {
    const pair = [ansahKept, ansahDuplicate];
    for (const key of Object.keys(ansahKept).filter(k => k !== "event_id")) {
      const changed = pair.map((s, index) => index === row ? { ...s, [key]: "changed" } : s);
      assert.equal(excludeVerifiedDuplicateShots(changed).length, 2, `${row}:${key}`);
    }
  }
  for (const raw of [[ansahKept], [ansahDuplicate], [ansahKept, { ...ansahKept }, ansahDuplicate], [ansahKept, ansahDuplicate, { ...ansahDuplicate }]]) {
    assert.equal(excludeVerifiedDuplicateShots(raw).length, raw.length);
  }
});

test("does not collapse other same-time/location attempts or penalty rebounds", () => {
  for (const changes of [{ match_id: "other" }, { source_event_id: "unverified" }, { situation: "Penalty", outcome: "Saved" }]) {
    const pair = [ansahKept, ansahDuplicate].map(s => ({ ...s, ...changes }));
    assert.equal(shootingAttempts(pair).length, 2);
  }
});

test("stored reconciliation rejects missing kept shots, counted duplicates and altered internal provenance", () => {
  const resolutions = verifiedShotDuplicates([ansahKept, ansahDuplicate]);
  const article = { shots: [{ eventId: "kept" }], evidence: [{ id: "shots.reconciliation", context: { presentation: "internal", resolutions } }] };
  assert.deepEqual(storedShotDuplicateErrors(article), []);
  assert(storedShotDuplicateErrors({ ...article, shots: [] }).length);
  assert(storedShotDuplicateErrors({ ...article, shots: [{ eventId: "kept" }, { eventId: "duplicate" }] }).length);
  const altered = structuredClone(article);
  altered.evidence[0].context.resolutions[0].sourceUrl = "https://example.test/unverified";
  assert(storedShotDuplicateErrors(altered).length);
});

test("counts the independently documented Levi goal-line clearance separately from the Ansah duplicate", () => {
  const levi = { match_id: ansah.match_id, source_code: "365scores", source_event_id: "164739306", team_id: "a3de4ba2-63b7-475e-9975-8f2bb118d546", player_id: "3c2fc94a-90e4-41dc-9325-2f710214d51b", minute: 59, outcome: "Blocked" };
  assert.equal(shotsOnTargetSummary([levi, { ...levi, source_event_id: "save", outcome: "Saved" }], levi.team_id).count, 2);
  for (const key of ["match_id", "source_code", "source_event_id", "team_id", "player_id", "minute"]) assert.equal(verifiedGoalLineBlock({ ...levi, [key]: "changed" }), null, key);
  assert.equal(shotsOnTargetSummary([{ ...levi, outcome: "Saved" }], levi.team_id).count, 1);
});
