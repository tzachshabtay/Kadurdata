import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerLeaderboardRow, PlayerLoan, SeasonPlayer } from "./types";

export type LoanPlayerContext = SeasonPlayer & { loan_player_id: string };

export function mergeLoanLeaderboardRows(
  loans: PlayerLoan[],
  parentTeamId: string,
  selectedCompetitionRows: PlayerLeaderboardRow[],
  destinationRows: PlayerLeaderboardRow[],
) {
  const loanIds = new Set(loans.map((loan) => loan.player_id));
  // Keep known destination stats if a provider's loan uses a separate club
  // record, but never substitute the parent's own totals for loan minutes.
  const byPlayerId = new Map(selectedCompetitionRows
    .filter((row) => loanIds.has(row.player_id) && row.team_id && row.team_id !== parentTeamId)
    .map((row) => [row.player_id, row]));
  destinationRows.filter((row) => loanIds.has(row.player_id))
    .forEach((row) => byPlayerId.set(row.player_id, row));
  return [...byPlayerId.values()];
}

// A loan belongs to the parent's season, but its playing stats belong to the
// destination's competition. Never fall back to the parent's zero-minute row.
export async function fetchLoanPlayerContexts(
  client: Pick<SupabaseClient, "rpc">,
  loans: PlayerLoan[],
  seasonName: string,
) {
  const results = await Promise.all(loans.map(async (loan) => {
    if (!loan.destination_team_id) return { players: [], error: null };
    try {
      const result = await client.rpc("api_player_context_for_team_season", {
        p_player_id: loan.player_id,
        p_season_name: seasonName,
        p_team_id: loan.destination_team_id,
      });
      return {
        players: result.error ? [] : ((result.data ?? []) as SeasonPlayer[]).map((player): LoanPlayerContext => ({
          ...player, loan_player_id: loan.player_id,
        })),
        error: result.error,
      };
    } catch (error) {
      return { players: [], error: { message: error instanceof Error ? error.message : String(error) } };
    }
  }));
  return {
    players: results.flatMap((result) => result.players),
    error: results.find((result) => result.error)?.error?.message ?? null,
  };
}
