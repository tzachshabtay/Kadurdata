import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerLoan, SeasonPlayer } from "./types";

// A loan belongs to the parent's season, but its playing stats belong to the
// destination's competition. Never fall back to the parent's zero-minute row.
export async function fetchLoanPlayerContexts(
  client: Pick<SupabaseClient, "rpc">,
  loans: PlayerLoan[],
  seasonName: string,
) {
  const results = await Promise.all(loans.map(async (loan) => {
    if (!loan.destination_team_id) return { data: [], error: null };
    try {
      return await client.rpc("api_player_context_for_team_season", {
        p_player_id: loan.player_id,
        p_season_name: seasonName,
        p_team_id: loan.destination_team_id,
      });
    } catch (error) {
      return { data: [], error: { message: error instanceof Error ? error.message : String(error) } };
    }
  }));
  return {
    players: results.flatMap((result) => result.error ? [] : (result.data ?? []) as SeasonPlayer[]),
    error: results.find((result) => result.error)?.error?.message ?? null,
  };
}
