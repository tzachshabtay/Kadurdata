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

const ROLE_LABELS_HE = {
  Defender: "הגנה",
  Midfielder: "קישור",
  Attacker: "התקפה",
  Goalkeeper: "שוער",
  Other: "אחר",
};

function decisiveFlowWindow(flowWindows) {
  return [...flowWindows].sort((left, right) => {
    const leftScore = Math.abs(left.home.goals - left.away.goals) * 20 + Math.abs(left.home.xg - left.away.xg) * 10;
    const rightScore = Math.abs(right.home.goals - right.away.goals) * 20 + Math.abs(right.home.xg - right.away.xg) * 10;
    return rightScore - leftScore;
  })[0] ?? null;
}

function playerIdentity(player) {
  return {
    playerId: player.playerId,
    playerNameHe: player.nameHe,
    roleGroup: player.roleGroup,
    roleLabelHe: ROLE_LABELS_HE[player.roleGroup] ?? ROLE_LABELS_HE.Other,
    positionName: player.positionName,
    formationPosition: player.formationPosition,
  };
}

function aggregateShotsByRole(shots, playerById) {
  const roles = new Map();
  for (const shot of shots) {
    const player = playerById.get(shot.player_id);
    const roleGroup = player?.roleGroup ?? "Other";
    const current = roles.get(roleGroup) ?? {
      roleGroup,
      roleLabelHe: ROLE_LABELS_HE[roleGroup] ?? ROLE_LABELS_HE.Other,
      shots: 0,
      expectedGoals: 0,
      goals: 0,
      centralPenaltyAreaShots: 0,
    };
    current.shots += 1;
    current.expectedGoals += Number(shot.xg ?? 0);
    current.goals += shot.outcome === "Goal" ? 1 : 0;
    current.centralPenaltyAreaShots += Number(shot.x) >= 88 && Number(shot.y) >= 35 && Number(shot.y) <= 65 ? 1 : 0;
    roles.set(roleGroup, current);
  }
  return [...roles.values()]
    .map((role) => ({
      ...role,
      expectedGoals: round(role.expectedGoals),
      expectedGoalsPerShot: role.shots ? round(role.expectedGoals / role.shots, 3) : 0,
    }))
    .sort((left, right) => right.expectedGoals - left.expectedGoals);
}

function aggregateShotsByPlayer(shots, playerById) {
  const totals = new Map();
  for (const shot of shots) {
    const player = playerById.get(shot.player_id);
    const current = totals.get(shot.player_id) ?? {
      ...(player ? playerIdentity(player) : {
        playerId: shot.player_id,
        playerNameHe: shot.display_name_he ?? shot.display_name,
        roleGroup: "Other",
        roleLabelHe: ROLE_LABELS_HE.Other,
        positionName: null,
        formationPosition: null,
      }),
      shots: 0,
      expectedGoals: 0,
      goals: 0,
      centralPenaltyAreaShots: 0,
    };
    current.shots += 1;
    current.expectedGoals += Number(shot.xg ?? 0);
    current.goals += shot.outcome === "Goal" ? 1 : 0;
    current.centralPenaltyAreaShots += Number(shot.x) >= 88 && Number(shot.y) >= 35 && Number(shot.y) <= 65 ? 1 : 0;
    totals.set(shot.player_id, current);
  }
  return [...totals.values()]
    .map((player) => ({ ...player, expectedGoals: round(player.expectedGoals) }))
    .sort((left, right) => right.expectedGoals - left.expectedGoals || right.shots - left.shots);
}

function unitCreationProfile(units) {
  return Object.entries(units).map(([unitKey, unit]) => ({
    unitKey,
    roleLabelHe: unitKey === "defenders" ? "הגנה" : unitKey === "midfielders" ? "קישור" : "התקפה",
    shots: unit.shots,
    expectedGoals: unit.expectedGoals,
    expectedGoalsPerShot: unit.shots ? round(unit.expectedGoals / unit.shots, 3) : 0,
    expectedAssists: unit.expectedAssists,
    keyPasses: unit.keyPasses,
    assists: unit.assists,
  }));
}

function spatialRoleContext(spatialTeam) {
  if (!spatialTeam) return null;
  const outfield = spatialTeam.players.filter((player) => player.roleGroup !== "Goalkeeper");
  return {
    centralLanePlayers: spatialTeam.centralLanePlayers,
    halfSpacePlayers: spatialTeam.halfSpacePlayers,
    wideLanePlayers: spatialTeam.wideLanePlayers,
    width: spatialTeam.width,
    mostAdvancedPlayers: [...outfield].sort((left, right) => right.x - left.x).slice(0, 3),
    widestPlayers: [...outfield].sort((left, right) => Math.abs(right.y - 50) - Math.abs(left.y - 50)).slice(0, 4),
  };
}

function teamMechanismSummary(team, shots, players, units, spatialTeam, distortionMinute) {
  const playerById = new Map(players.map((player) => [player.playerId, player]));
  const relevant = shots.filter((shot) => shot.team_id === team.teamId && Number(shot.minute) <= distortionMinute);
  const rawExpectedGoals = round(relevant.reduce((sum, shot) => sum + Number(shot.xg ?? 0), 0));
  const expectedGoals = relevant.length === Number(team.stats?.team_total_shots)
    ? round(team.stats?.team_expected_goals ?? rawExpectedGoals)
    : rawExpectedGoals;
  const centralPenaltyArea = relevant.filter((shot) => Number(shot.x) >= 88 && Number(shot.y) >= 35 && Number(shot.y) <= 65);
  const highQuality = relevant.filter((shot) => Number(shot.xg ?? 0) >= 0.2);
  return {
    teamId: team.teamId,
    teamNameHe: team.nameHe,
    scopeEndMinute: distortionMinute,
    shots: relevant.length,
    expectedGoals,
    expectedGoalsPerShot: relevant.length ? round(expectedGoals / relevant.length, 3) : 0,
    centralPenaltyAreaShots: centralPenaltyArea.length,
    centralPenaltyAreaExpectedGoals: round(centralPenaltyArea.reduce((sum, shot) => sum + Number(shot.xg ?? 0), 0)),
    highQualityShots: highQuality.length,
    highQualityExpectedGoals: round(highQuality.reduce((sum, shot) => sum + Number(shot.xg ?? 0), 0)),
    finishingByRole: aggregateShotsByRole(relevant, playerById),
    leadingShooters: aggregateShotsByPlayer(relevant, playerById).slice(0, 4),
    fullMatchCreationByUnit: unitCreationProfile(units),
    spatialStructure: spatialRoleContext(spatialTeam),
  };
}

function eventWithRoles(event, playerByName) {
  const player = playerByName.get(event.playerNameHe);
  return {
    ...event,
    playerRoleGroup: player?.roleGroup ?? null,
    playerRoleLabelHe: player ? (ROLE_LABELS_HE[player.roleGroup] ?? ROLE_LABELS_HE.Other) : null,
    relatedPlayers: event.relatedPlayerNamesHe.map((nameHe) => {
      const related = playerByName.get(nameHe);
      return {
        playerNameHe: nameHe,
        roleGroup: related?.roleGroup ?? null,
        roleLabelHe: related ? (ROLE_LABELS_HE[related.roleGroup] ?? ROLE_LABELS_HE.Other) : null,
      };
    }),
  };
}

export function buildMechanismContext({ shots, players, home, away, unitMatchups, spatialProfile, flowWindows, timelineEvents, gameStateContext }) {
  const distortingEvent = gameStateContext.materialEvents.find((event) => event.eventId === gameStateContext.distortingEventId) ?? null;
  const distortionMinute = distortingEvent?.minute ?? 105;
  const decisiveWindow = decisiveFlowWindow(flowWindows);
  const playerByName = new Map(players.map((player) => [player.nameHe, player]));
  const eventsNearWindow = decisiveWindow ? timelineEvents
    .filter((event) => event.minute >= Math.max(1, decisiveWindow.start - 15) && event.minute <= decisiveWindow.end)
    .filter((event) => event.type === "Goal" || event.type === "Substitution" || event.type === "Red Card")
    .map((event) => eventWithRoles(event, playerByName)) : [];
  const teamSummaries = {
    home: teamMechanismSummary(home, shots, players, unitMatchups.home, spatialProfile?.home, distortionMinute),
    away: teamMechanismSummary(away, shots, players, unitMatchups.away, spatialProfile?.away, distortionMinute),
  };
  const betterQualitySide = teamSummaries.home.expectedGoalsPerShot >= teamSummaries.away.expectedGoalsPerShot ? "home" : "away";
  const windowGoalGap = decisiveWindow ? Math.abs(decisiveWindow.home.goals - decisiveWindow.away.goals) : 0;
  const windowExpectedGoalsGap = decisiveWindow ? round(Math.abs(decisiveWindow.home.xg - decisiveWindow.away.xg)) : 0;
  return {
    methodHe: "הסבר משולב ולא הוכחת סיבתיות: מיקום בעיטות וחוליית המסיים נמדדו עד לאירוע שעיוות את מצב המשחק; נתוני יצירה לפי חוליה ומפות החום מסכמים את כל זמן ההופעה; אירועים וחילופים מתוזמנים בנפרד.",
    distortionCutoffMinute: distortingEvent?.minute ?? null,
    distortionEventId: distortingEvent?.eventId ?? "",
    centralPenaltyAreaRule: { minimumX: 88, minimumY: 35, maximumY: 65 },
    highQualityShotThreshold: 0.2,
    teams: teamSummaries,
    betterQualitySide,
    qualityPerShotGap: round(Math.abs(teamSummaries.home.expectedGoalsPerShot - teamSummaries.away.expectedGoalsPerShot), 3),
    decisiveWindow: decisiveWindow ? {
      ...decisiveWindow,
      goalGap: windowGoalGap,
      expectedGoalsGap: windowExpectedGoalsGap,
      eventsFromFifteenMinutesBefore: eventsNearWindow,
      homeShooters: aggregateShotsByPlayer(
        shots.filter((shot) => shot.team_id === home.teamId && Number(shot.minute) >= decisiveWindow.start && Number(shot.minute) <= decisiveWindow.end),
        new Map(players.map((player) => [player.playerId, player])),
      ),
      awayShooters: aggregateShotsByPlayer(
        shots.filter((shot) => shot.team_id === away.teamId && Number(shot.minute) >= decisiveWindow.start && Number(shot.minute) <= decisiveWindow.end),
        new Map(players.map((player) => [player.playerId, player])),
      ),
    } : null,
    hasChanceCreationSignal: Math.abs(teamSummaries.home.expectedGoals - teamSummaries.away.expectedGoals) >= 0.75
      || Math.abs(teamSummaries.home.expectedGoalsPerShot - teamSummaries.away.expectedGoalsPerShot) >= 0.08,
    hasDecisiveWindowSignal: windowGoalGap >= 2 || windowExpectedGoalsGap >= 0.75,
  };
}

export function mechanismEvidenceValues(mechanismContext) {
  const teamValues = (team) => [
    team.scopeEndMinute,
    team.shots,
    team.expectedGoals,
    team.expectedGoalsPerShot,
    team.centralPenaltyAreaShots,
    team.centralPenaltyAreaExpectedGoals,
    team.highQualityShots,
    team.highQualityExpectedGoals,
    ...team.finishingByRole.flatMap((role) => [role.shots, role.expectedGoals, role.goals, role.centralPenaltyAreaShots, role.expectedGoalsPerShot]),
    ...team.leadingShooters.flatMap((player) => [player.shots, player.expectedGoals, player.goals, player.centralPenaltyAreaShots]),
    ...team.fullMatchCreationByUnit.flatMap((unit) => [unit.shots, unit.expectedGoals, unit.expectedGoalsPerShot, unit.expectedAssists, unit.keyPasses, unit.assists]),
  ];
  const window = mechanismContext.decisiveWindow;
  return [
    mechanismContext.distortionCutoffMinute,
    mechanismContext.centralPenaltyAreaRule.minimumX,
    mechanismContext.centralPenaltyAreaRule.minimumY,
    mechanismContext.centralPenaltyAreaRule.maximumY,
    mechanismContext.highQualityShotThreshold,
    mechanismContext.qualityPerShotGap,
    ...teamValues(mechanismContext.teams.home),
    ...teamValues(mechanismContext.teams.away),
    ...(window ? [
      window.start,
      window.end,
      window.goalGap,
      window.expectedGoalsGap,
      window.home.shots,
      window.home.xg,
      window.home.goals,
      window.away.shots,
      window.away.xg,
      window.away.goals,
      ...window.eventsFromFifteenMinutesBefore.map((event) => event.minute),
      ...window.homeShooters.flatMap((player) => [player.shots, player.expectedGoals, player.goals]),
      ...window.awayShooters.flatMap((player) => [player.shots, player.expectedGoals, player.goals]),
    ] : []),
  ].filter((value) => value !== null && value !== undefined);
}

export function buildHistoricalAuditContext(historicalContext) {
  const teamSignals = [
    ["home", historicalContext.teams.home],
    ["away", historicalContext.teams.away],
  ].flatMap(([side, team]) => Object.entries(team.metrics)
    .filter(([, metric]) => metric.sampleSize >= 3 && metric.changePercent !== null)
    .map(([metricCode, metric]) => ({
      side,
      teamId: team.teamId,
      teamNameHe: team.nameHe,
      metricCode,
      ...metric,
      evidenceId: `history.team.${side}`,
    })))
    .sort((left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent));
  const playerSignals = historicalContext.players.flatMap((player) => player.notableChanges.map((change) => ({
    playerId: player.playerId,
    playerNameHe: player.nameHe,
    teamId: player.teamId,
    evidenceId: `history.player.${player.playerId}`,
    ...change,
  }))).sort((left, right) => Math.abs(right.zScore ?? 0) - Math.abs(left.zScore ?? 0));
  return {
    scopeHe: historicalContext.scopeHe,
    teamMetricSeriesReviewed: teamSignals.length,
    playerProfilesReviewed: historicalContext.players.length,
    eligiblePlayerSignals: playerSignals.length,
    strongestTeamSignals: teamSignals.slice(0, 6),
    strongestPlayerSignals: playerSignals.slice(0, 6),
  };
}

export function historicalAuditEvidenceValues(historicalAuditContext) {
  return [
    historicalAuditContext.teamMetricSeriesReviewed,
    historicalAuditContext.playerProfilesReviewed,
    historicalAuditContext.eligiblePlayerSignals,
    ...historicalAuditContext.strongestTeamSignals.flatMap((signal) => [signal.current, signal.average, signal.sampleSize, signal.delta, signal.changePercent]),
    ...historicalAuditContext.strongestPlayerSignals.flatMap((signal) => [signal.current, signal.currentPer90, signal.previousPer90, signal.previousStdDevPer90, signal.deltaPer90, signal.changePercent, signal.zScore, signal.sampleSize]),
  ].filter((value) => value !== null && value !== undefined);
}

export function buildInsightCandidates({ home, away, flowWindows, gameStateContext, historicalContext, unitMatchups, spatialProfile, mechanismContext }) {
  const qualityGap = Math.abs(Number(home.stats.team_expected_goals ?? 0) - Number(away.stats.team_expected_goals ?? 0));
  const bigChanceGap = Math.abs(Number(home.stats.team_big_chances_created ?? 0) - Number(away.stats.team_big_chances_created ?? 0));
  const decisiveWindow = decisiveFlowWindow(flowWindows);
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
      id: "chance_creation_mechanism",
      category: "quality",
      score: mechanismContext.hasChanceCreationSignal ? Math.min(99, round(82 + qualityGap * 6 + mechanismContext.qualityPerShotGap * 30)) : 35,
      evidenceIds: ["mechanism.chance_creation", "team.quality", "match.shot_map", "heatmap.spatial_profile"],
      context: mechanismContext,
    },
    {
      id: "decisive_match_window",
      category: "flow",
      score: decisiveWindow ? Math.min(96, 45 + Math.abs(decisiveWindow.home.goals - decisiveWindow.away.goals) * 15 + Math.abs(decisiveWindow.home.xg - decisiveWindow.away.xg) * 8) : 0,
      evidenceIds: ["flow.shot_windows", "timeline.match_events"],
      context: decisiveWindow,
    },
    {
      id: "decisive_window_mechanism",
      category: "flow",
      score: mechanismContext.hasDecisiveWindowSignal ? Math.min(98, round(80 + mechanismContext.decisiveWindow.goalGap * 5 + mechanismContext.decisiveWindow.expectedGoalsGap * 5)) : 35,
      evidenceIds: ["mechanism.decisive_window", "flow.shot_windows", "timeline.match_events"],
      context: mechanismContext.decisiveWindow,
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
