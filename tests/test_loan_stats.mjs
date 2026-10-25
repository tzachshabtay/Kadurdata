import test from "node:test";
import assert from "node:assert/strict";
import { fetchLoanPlayerContexts, mergeLoanLeaderboardRows } from "../src/lib/loanStats.ts";

const loan = {
  player_id: "lotem",
  season_id: "premier-league-season",
  parent_team_id: "maccabi",
  destination_team_id: "kfar-shalem",
};

test("loan stats request the destination team, even when the parent season has zero minutes", async () => {
  const destinationPlayer = { player_id: "lotem", season_id: "leumit-season", minutes: 159 };
  const calls = [];
  const client = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      return { data: [destinationPlayer], error: null };
    },
  };
  const result = await fetchLoanPlayerContexts(client, [loan], "2026/2027");
  assert.deepEqual(calls, [{
    name: "api_player_context_for_team_season",
    params: { p_player_id: "lotem", p_season_name: "2026/2027", p_team_id: "kfar-shalem" },
  }]);
  assert.deepEqual(result.players, [{ ...destinationPlayer, loan_player_id: "lotem" }]);
  assert.equal(result.error, null);
});

test("unresolved destinations and missing records stay unavailable instead of using parent totals", async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: [], error: null }; } };
  assert.deepEqual(await fetchLoanPlayerContexts(client, [loan, { ...loan, destination_team_id: null }], "2026/2027"), {
    players: [], error: null,
  });
  assert.equal(calls, 1);
});

test("a failed context lookup reports the error while preserving other loan records", async () => {
  const client = { rpc: async (_name, params) => params.p_player_id === "lotem"
    ? { data: null, error: { message: "lookup failed" } }
    : { data: [{ player_id: "other", minutes: 90 }], error: null } };
  const result = await fetchLoanPlayerContexts(client, [loan, { ...loan, player_id: "other" }], "2026/2027");
  assert.deepEqual(result, { players: [{ player_id: "other", loan_player_id: "other", minutes: 90 }], error: "lookup failed" });
});

test("a resolved player alias retains both the loan identity and the identity holding the statistics", async () => {
  const client = { rpc: async () => ({ data: [{ player_id: "match-player", minutes: 358 }], error: null }) };
  const result = await fetchLoanPlayerContexts(client, [{ ...loan, player_id: "loan-player" }], "2026/2027");
  assert.deepEqual(result.players, [{ player_id: "match-player", loan_player_id: "loan-player", minutes: 358 }]);
});

test("destination totals replace parent zeros while existing stats survive a provider club alias", () => {
  const rows = [
    { player_id: "lotem", team_id: "maccabi", leaderboard_value: 0 },
    { player_id: "ido", team_id: "ramat-gan-match-record", leaderboard_value: 484 },
    { player_id: "other", team_id: "other", leaderboard_value: 900 },
  ];
  const loans = [loan, { ...loan, player_id: "ido", destination_team_id: "ramat-gan-loan-record" }];
  const destination = { player_id: "lotem", team_id: "kfar-shalem", leaderboard_value: 159 };
  assert.deepEqual(mergeLoanLeaderboardRows(loans, "maccabi", rows, [destination]), [rows[1], destination]);
  assert.deepEqual(mergeLoanLeaderboardRows(loans, "maccabi", rows, []), [rows[1]]);
});
