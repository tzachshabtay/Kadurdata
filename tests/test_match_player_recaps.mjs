import test from "node:test";
import assert from "node:assert/strict";
import { matchPlayerRecapEvidence, validateMatchPlayerRecaps } from "../scripts/content_match_player_recaps.mjs";
import { buildReviewPacket } from "../scripts/content_language_review.mjs";

const players = [
  { playerId: "one", nameHe: "שחקן ראשון", teamId: "home", minutes: 90, metrics: { minutes: 90, rating_365: 7.4, key_passes: 3 } },
  { playerId: "two", nameHe: "שחקן שני", teamId: "away", minutes: 5, metrics: { minutes: 5, total_shots: 2 } },
  { playerId: "bench", nameHe: "מחליף שלא נכנס", teamId: "away", minutes: 0, metrics: {} },
];
const recaps = [
  { playerId: "one", nameHe: "שחקן ראשון", text: "מסר 3 מסירות מפתח.", statCodes: ["key_passes"], evidenceIds: ["player.match.one"] },
  { playerId: "two", nameHe: "שחקן שני", text: "בעט 2 פעמים בהופעה קצרה.", statCodes: ["total_shots"], evidenceIds: ["player.match.two"] },
];

test("all participants, including an unrated substitute, are required but unused bench players are excluded", () => {
  assert.deepEqual(validateMatchPlayerRecaps(players, recaps), []);
  assert.match(validateMatchPlayerRecaps(players, recaps.slice(0, 1)).join(" "), /Missing played player/);
  assert.match(validateMatchPlayerRecaps(players, [...recaps, recaps[0]]).join(" "), /duplicate/);
});

test("a teammate's statistic cannot validate a player's sentence", () => {
  const wrong = structuredClone(recaps);
  wrong[1].text = "בעט 3 פעמים.";
  wrong[1].evidenceIds.push("player.match.one");
  assert.match(validateMatchPlayerRecaps(players, wrong).join(" "), /Unsupported recap number 3/);
  wrong[1].statCodes = ["missing_stat"];
  assert.match(validateMatchPlayerRecaps(players, wrong).join(" "), /statistics are unavailable/);
});

test("evidence preserves available values and never fabricates a missing rating", () => {
  const before = structuredClone(players);
  const evidence = matchPlayerRecapEvidence(players);
  assert.equal(evidence.length, 2);
  assert.ok(evidence[0].values.includes(7.4));
  assert.equal(evidence[1].context.metrics.rating_365, undefined);
  assert.deepEqual(evidence[1].values, [5, 2]);
  assert.deepEqual(players, before);
});

test("review hashes and exact sentence coverage include both recap text and Hebrew names", () => {
  const input = { schemaVersion: 2, draftEditorial: null, editorial: { headline: "סיכום המשחק" }, analysisPlan: { graphics: [] }, playerRecaps: recaps };
  const before = buildReviewPacket(input);
  assert.ok(before.sentences.some((entry) => entry.location === "playerRecaps.0.nameHe.sentence.0"));
  assert.ok(before.sentences.some((entry) => entry.text === recaps[1].text));
  const changed = structuredClone(input);
  changed.playerRecaps[1].nameHe = "שם אחר";
  assert.notEqual(buildReviewPacket(changed).finalHash, before.finalHash);
  assert.notEqual(buildReviewPacket(changed).numberlessHash, before.numberlessHash);
  changed.playerRecaps[1].text = "משפט אחר.";
  assert.notEqual(buildReviewPacket(changed).finalHash, before.finalHash);
});

test("existing match articles without recap sections remain supported", () => {
  assert.deepEqual(validateMatchPlayerRecaps(players, undefined), []);
  const old = buildReviewPacket({ draftEditorial: null, editorial: { headline: "כותרת" }, analysisPlan: { graphics: [] } });
  assert.equal(old.sentences.length, 1);
});
