// Eligibility belongs to the recorded appearance, not the player's current or
// season-level census membership. A return to Israel must not import home games.
export function filterLegionnaireHistory(rows, seasons, competitions, seasonName) {
  const seasonById = new Map(seasons.map((season) => [season.season_id, season]));
  const competitionById = new Map(competitions.map((competition) => [competition.competition_id, competition]));
  const excluded = new Map();
  const eligible = [];
  for (const row of rows) {
    const season = seasonById.get(row.season_id);
    const competition = competitionById.get(row.competition_id);
    let reason = null;
    if (!season || !competition || season.competition_id !== row.competition_id) reason = "unverified_competition_or_season";
    else if (competition.scope !== "foreign_club") reason = "not_foreign_club";
    else if (season.season_name !== seasonName) reason = "different_season";
    if (reason) {
      excluded.set(`${row.player_id}:${row.match_id}`, {
        playerId: row.player_id, matchId: row.match_id, teamName: row.team_name,
        scheduledAt: row.scheduled_at, seasonId: row.season_id,
        competitionId: row.competition_id, reason,
      });
      continue;
    }
    eligible.push({ ...row, season_name: season.season_name,
      competition_scope: competition.scope,
      competition_name: competition.name_he || competition.name });
  }
  return { rows: eligible, excludedAppearances: [...excluded.values()] };
}

export function assertWeeklyEligibility(article) {
  if (article.kind !== "legionnaire_weekly") return;
  if (typeof article.period?.seasonName !== "string" || !article.period.seasonName.trim()) {
    throw new Error("Weekly eligibility: missing reporting season.");
  }
  const players = article.summary?.players;
  if (!Array.isArray(players) || !players.length) throw new Error("Weekly eligibility: no verified player appearances.");
  for (const player of players) {
    if (!player.matches?.length) throw new Error(`Weekly eligibility: missing appearances for ${player.nameHe}.`);
    for (const match of player.matches) {
      if (!match.matchId || !match.seasonId || !match.competitionId || match.competitionScope !== "foreign_club"
          || match.seasonName !== article.period?.seasonName) {
        throw new Error(`Weekly eligibility: ${player.nameHe} / ${match.matchId} is not a verified foreign-club appearance in the reporting season.`);
      }
    }
  }
}
