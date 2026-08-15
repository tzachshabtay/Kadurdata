alter function public.api_player_leaderboard(uuid, text) security definer;

revoke all on function public.api_player_leaderboard(uuid, text) from public;
grant execute on function public.api_player_leaderboard(uuid, text) to anon, authenticated;
