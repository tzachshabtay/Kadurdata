function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function shotSummary(shots, teamId, predicate = () => true) {
  const relevant = shots.filter((shot) => shot.team_id === teamId && predicate(shot));
  return {
    shots: relevant.length,
    expectedGoals: round(relevant.reduce((sum, shot) => sum + Number(shot.xg ?? 0), 0)),
    goals: relevant.filter((shot) => shot.outcome === "Goal").length,
  };
}

function scoreAtMinute(timelineEvents, homeTeamId, awayTeamId, minute) {
  const goals = timelineEvents.filter((event) => event.type === "Goal" && event.minute <= minute);
  return {
    home: goals.filter((event) => event.teamId === homeTeamId).length,
    away: goals.filter((event) => event.teamId === awayTeamId).length,
  };
}

export function buildGameStateContext(shots, timelineEvents, home, away) {
  const homeTotal = shotSummary(shots, home.teamId);
  const awayTotal = shotSummary(shots, away.teamId);
  homeTotal.expectedGoals = round(home.stats?.team_expected_goals ?? homeTotal.expectedGoals);
  awayTotal.expectedGoals = round(away.stats?.team_expected_goals ?? awayTotal.expectedGoals);
  const materialEvents = timelineEvents
    .filter((event) => event.type === "Red Card")
    .sort((left, right) => left.minute - right.minute)
    .map((event) => {
      const score = scoreAtMinute(timelineEvents, home.teamId, away.teamId, event.minute);
      const homeBefore = shotSummary(shots, home.teamId, (shot) => Number(shot.minute) <= event.minute);
      const awayBefore = shotSummary(shots, away.teamId, (shot) => Number(shot.minute) <= event.minute);
      const homeAfter = shotSummary(shots, home.teamId, (shot) => Number(shot.minute) > event.minute);
      const awayAfter = shotSummary(shots, away.teamId, (shot) => Number(shot.minute) > event.minute);
      return {
        eventId: event.id,
        type: event.type,
        minute: event.minute,
        teamId: event.teamId,
        teamNameHe: event.teamNameHe,
        playerNameHe: event.playerNameHe,
        score,
        scoreGap: Math.abs(score.home - score.away),
        home: {
          before: homeBefore,
          after: homeAfter,
          afterShotShare: homeTotal.shots ? round(homeAfter.shots * 100 / homeTotal.shots) : 0,
        },
        away: {
          before: awayBefore,
          after: awayAfter,
          afterShotShare: awayTotal.shots ? round(awayAfter.shots * 100 / awayTotal.shots) : 0,
        },
      };
    });

  const lateCutoff = 75;
  const homeLate = shotSummary(shots, home.teamId, (shot) => Number(shot.minute) > lateCutoff);
  const awayLate = shotSummary(shots, away.teamId, (shot) => Number(shot.minute) > lateCutoff);
  const shotTotalGap = Math.abs(homeTotal.shots - awayTotal.shots);
  const similarShotTotals = shotTotalGap <= 2;
  const distortingEvent = materialEvents.find((event) => (
    event.scoreGap >= 2
    && Math.max(event.home.afterShotShare, event.away.afterShotShare) >= 35
  ));

  return {
    homeTeamNameHe: home.nameHe,
    awayTeamNameHe: away.nameHe,
    totals: { home: homeTotal, away: awayTotal, shotTotalGap, similarShotTotals },
    lateWindow: {
      afterMinute: lateCutoff,
      home: { ...homeLate, shotShare: homeTotal.shots ? round(homeLate.shots * 100 / homeTotal.shots) : 0 },
      away: { ...awayLate, shotShare: awayTotal.shots ? round(awayLate.shots * 100 / awayTotal.shots) : 0 },
    },
    materialEvents,
    rawShotTotalsNeedGameStateContext: Boolean(similarShotTotals && distortingEvent),
    distortingEventId: distortingEvent?.eventId ?? "",
  };
}

function largestHistoricalChange(teamHistory) {
  return Object.entries(teamHistory.metrics)
    .filter(([, metric]) => metric.sampleSize >= 3 && metric.changePercent !== null)
    .map(([metricCode, metric]) => ({ metricCode, ...metric }))
    .sort((left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent))[0] ?? null;
}

export function buildInsightCandidates({ home, away, flowWindows, gameStateContext, historicalContext, unitMatchups, spatialProfile }) {
  const qualityGap = Math.abs(Number(home.stats.team_expected_goals ?? 0) - Number(away.stats.team_expected_goals ?? 0));
  const bigChanceGap = Math.abs(Number(home.stats.team_big_chances_created ?? 0) - Number(away.stats.team_big_chances_created ?? 0));
  const decisiveWindow = [...flowWindows].sort((left, right) => {
    const leftScore = Math.abs(left.home.goals - left.away.goals) * 20 + Math.abs(left.home.xg - left.away.xg) * 10;
    const rightScore = Math.abs(right.home.goals - right.away.goals) * 20 + Math.abs(right.home.xg - right.away.xg) * 10;
    return rightScore - leftScore;
  })[0];
  const homeHistoryChange = largestHistoricalChange(historicalContext.teams.home);
  const awayHistoryChange = largestHistoricalChange(historicalContext.teams.away);
  const notablePlayers = historicalContext.players
    .flatMap((player) => player.notableChanges.map((change) => ({
      playerId: player.playerId,
      playerNameHe: player.nameHe,
      teamId: player.teamId,
      ...change,
    })))
    .sort((left, right) => Math.abs(right.zScore ?? right.changePercent) - Math.abs(left.zScore ?? left.changePercent))
    .slice(0, 4);
  const moreProgressionTeam = Number(home.stats.team_passes_into_final_third ?? 0) >= Number(away.stats.team_passes_into_final_third ?? 0) ? home : away;
  const betterQualityTeam = Number(home.stats.team_expected_goals ?? 0) >= Number(away.stats.team_expected_goals ?? 0) ? home : away;
  const midfieldGap = Math.abs(unitMatchups.home.midfielders.expectedGoals - unitMatchups.away.midfielders.expectedGoals)
    + Math.abs(unitMatchups.home.midfielders.goals - unitMatchups.away.midfielders.goals);

  return [
    {
      id: "game_state_distortion",
      category: "game_state",
      score: gameStateContext.rawShotTotalsNeedGameStateContext ? 100 : (gameStateContext.materialEvents.length ? 65 : 20),
      evidenceIds: ["team.volume", "flow.game_state_context", "timeline.match_events"],
      context: gameStateContext,
    },
    {
      id: "chance_quality_gap",
      category: "quality",
      score: Math.min(98, round(45 + qualityGap * 15 + bigChanceGap * 4)),
      evidenceIds: ["team.volume", "team.quality", "match.shot_map"],
      context: { qualityGap: round(qualityGap), bigChanceGap, home: home.nameHe, away: away.nameHe },
    },
    {
      id: "decisive_match_window",
      category: "flow",
      score: decisiveWindow ? Math.min(96, 45 + Math.abs(decisiveWindow.home.goals - decisiveWindow.away.goals) * 15 + Math.abs(decisiveWindow.home.xg - decisiveWindow.away.xg) * 8) : 0,
      evidenceIds: ["flow.shot_windows", "timeline.match_events"],
      context: decisiveWindow,
    },
    {
      id: "progression_without_quality",
      category: "style",
      score: moreProgressionTeam.teamId !== betterQualityTeam.teamId ? 82 : 35,
      evidenceIds: ["team.progression", "team.quality", "style.team_profiles"],
      context: { moreProgressionTeamNameHe: moreProgressionTeam.nameHe, betterQualityTeamNameHe: betterQualityTeam.nameHe },
    },
    {
      id: "midfield_matchup",
      category: "matchup",
      score: Math.min(90, round(40 + midfieldGap * 12)),
      evidenceIds: ["matchup.midfield", "heatmap.spatial_profile"],
      context: { home: unitMatchups.home.midfielders, away: unitMatchups.away.midfielders },
    },
    {
      id: "spatial_structure",
      category: "spatial",
      score: spatialProfile ? 60 + Math.min(25, Math.abs(spatialProfile.home.wideLanePlayers - spatialProfile.away.wideLanePlayers) * 8 + Math.abs(spatialProfile.home.centralLanePlayers - spatialProfile.away.centralLanePlayers) * 6) : 0,
      evidenceIds: ["heatmap.spatial_profile"],
      context: spatialProfile ? { home: spatialProfile.home, away: spatialProfile.away } : null,
    },
    {
      id: "team_history_change",
      category: "history",
      score: Math.min(88, 45 + Math.max(Math.abs(homeHistoryChange?.changePercent ?? 0), Math.abs(awayHistoryChange?.changePercent ?? 0)) / 2),
      evidenceIds: ["history.team.home", "history.team.away"],
      context: { home: homeHistoryChange, away: awayHistoryChange },
    },
    {
      id: "player_volume_outlier",
      category: "player",
      score: notablePlayers.length ? Math.min(85, 55 + Math.abs(notablePlayers[0].zScore ?? 0) * 10) : 0,
      evidenceIds: notablePlayers.map((player) => `history.player.${player.playerId}`),
      context: { players: notablePlayers },
    },
  ].filter((candidate) => candidate.score >= 30).sort((left, right) => right.score - left.score);
}

export function gameStateEvidenceValues(gameStateContext) {
  return [
    gameStateContext.totals.home.shots,
    gameStateContext.totals.home.expectedGoals,
    gameStateContext.totals.away.shots,
    gameStateContext.totals.away.expectedGoals,
    gameStateContext.totals.shotTotalGap,
    gameStateContext.lateWindow.afterMinute,
    gameStateContext.lateWindow.home.shots,
    gameStateContext.lateWindow.home.expectedGoals,
    gameStateContext.lateWindow.home.shotShare,
    gameStateContext.lateWindow.away.shots,
    gameStateContext.lateWindow.away.expectedGoals,
    gameStateContext.lateWindow.away.shotShare,
    ...gameStateContext.materialEvents.flatMap((event) => [
      event.minute,
      event.score.home,
      event.score.away,
      event.scoreGap,
      event.home.before.shots,
      event.home.before.expectedGoals,
      event.home.after.shots,
      event.home.after.expectedGoals,
      event.home.afterShotShare,
      event.away.before.shots,
      event.away.before.expectedGoals,
      event.away.after.shots,
      event.away.after.expectedGoals,
      event.away.afterShotShare,
    ]),
  ];
}
