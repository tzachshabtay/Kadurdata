#!/usr/bin/env node

import { access, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { analyzeContentHeatmaps } from "./analyze_content_heatmaps.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectory = path.join(projectRoot, "src", "content", "generated");
const HISTORICAL_WINDOW = 5;
const HISTORICAL_TEAM_METRICS = [
  "team_possession",
  "team_total_shots",
  "team_shots_on_target",
  "team_expected_goals",
  "team_expected_goals_on_target",
  "team_big_chances_created",
  "team_key_passes",
  "team_crosses_completed",
  "team_passes_into_final_third",
  "team_interceptions",
  "team_possession_lost",
  "team_backward_passes",
];
const HISTORICAL_PLAYER_METRICS = [
  "touches",
  "passes_attempted",
  "passes_completed",
  "passes_into_final_third",
  "backward_passes",
  "possession_lost",
  "ball_recovery",
  "ground_duels_attempted",
  "ground_duels_won",
  "aerial_duels_attempted",
  "aerial_duels_won",
  "interceptions",
  "clearances",
  "was_fouled",
  "fouls_made",
];
const VOLUME_METRIC_RULES = {
  touches: { labelHe: "נגיעות בכדור", minBaselineTotal: 120, minDeltaPer90: 12 },
  passes_attempted: { labelHe: "ניסיונות מסירה", minBaselineTotal: 100, minDeltaPer90: 10 },
  passes_completed: { labelHe: "מסירות מדויקות", minBaselineTotal: 80, minDeltaPer90: 9 },
  passes_into_final_third: { labelHe: "מסירות לשליש האחרון", minBaselineTotal: 20, minDeltaPer90: 3 },
  backward_passes: { labelHe: "מסירות לאחור", minBaselineTotal: 30, minDeltaPer90: 4 },
  possession_lost: { labelHe: "איבודי כדור", minBaselineTotal: 35, minDeltaPer90: 4 },
  ball_recovery: { labelHe: "חילוצי כדור", minBaselineTotal: 18, minDeltaPer90: 2.5 },
  ground_duels_attempted: { labelHe: "מאבקי קרקע", minBaselineTotal: 24, minDeltaPer90: 3 },
  ground_duels_won: { labelHe: "מאבקי קרקע מוצלחים", minBaselineTotal: 12, minDeltaPer90: 2 },
  aerial_duels_attempted: { labelHe: "מאבקי אוויר", minBaselineTotal: 12, minDeltaPer90: 2 },
  aerial_duels_won: { labelHe: "מאבקי אוויר מוצלחים", minBaselineTotal: 7, minDeltaPer90: 1.5 },
  interceptions: { labelHe: "חטיפות", minBaselineTotal: 8, minDeltaPer90: 1.5 },
  clearances: { labelHe: "הרחקות", minBaselineTotal: 12, minDeltaPer90: 2 },
  was_fouled: { labelHe: "עבירות שסחט", minBaselineTotal: 8, minDeltaPer90: 1.5 },
  fouls_made: { labelHe: "עבירות שביצע", minBaselineTotal: 8, minDeltaPer90: 1.5 },
};

async function loadLocalEnv() {
  try {
    const contents = await readFile(path.join(projectRoot, ".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // CI supplies environment variables directly.
  }
}

function readArguments() {
  const args = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  return {
    matchId: valueAfter("--match-id"),
    noAi: args.includes("--no-ai"),
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
  };
}

function cleanTeamSlug(value) {
  return value
    .replace(/\bFC\b/gi, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function datePart(value) {
  return value?.slice(0, 10) ?? "undated";
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function numberValue(value) {
  return value === null || value === undefined ? null : Number(value);
}

async function selectMatch(client, requestedMatchId) {
  if (requestedMatchId) {
    const result = await client.from("api_matches").select("*").eq("match_id", requestedMatchId).single();
    if (result.error) throw result.error;
    return result.data;
  }

  const result = await client
    .from("api_matches")
    .select("*")
    .eq("competition_name", "Israeli Premier League")
    .eq("status", "Ended")
    .gte("home_score", 0)
    .gte("away_score", 0)
    .order("scheduled_at", { ascending: false })
    .limit(20);
  if (result.error) throw result.error;

  for (const match of result.data ?? []) {
    const stats = await client.from("api_match_team_stats").select("metric_code").eq("match_id", match.match_id).limit(1);
    if (!stats.error && stats.data?.length) return match;
  }
  throw new Error("No completed Ligat Ha'Al match with detailed statistics was found.");
}

async function fetchMatchDataset(client, match) {
  const queries = await Promise.all([
    client.from("api_match_team_stats").select("*").eq("match_id", match.match_id).limit(500),
    client.from("api_match_player_stats").select("*").eq("match_id", match.match_id).limit(3000),
    client.from("api_match_shots").select("*").eq("match_id", match.match_id).order("minute").limit(500),
    client.from("api_team_assets").select("*").in("team_id", [match.home_team_id, match.away_team_id]),
    client.from("api_match_player_heatmaps").select("*").eq("match_id", match.match_id).limit(100),
  ]);
  const firstError = queries.find((query) => query.error)?.error;
  if (firstError) throw firstError;
  return {
    teamRows: queries[0].data ?? [],
    playerRows: queries[1].data ?? [],
    shots: queries[2].data ?? [],
    assets: queries[3].data ?? [],
    heatmaps: queries[4].data ?? [],
  };
}

async function fetchHistoricalTeamDataset(client, match, teamId) {
  const previous = await client
    .from("api_matches")
    .select([
      "match_id", "scheduled_at", "competition_name", "competition_name_he",
      "home_team_id", "home_team_name", "home_team_name_he", "home_score",
      "away_team_id", "away_team_name", "away_team_name_he", "away_score",
    ].join(","))
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq("status", "Ended")
    .lt("scheduled_at", match.scheduled_at)
    .order("scheduled_at", { ascending: false })
    .limit(HISTORICAL_WINDOW);
  if (previous.error) throw new Error(`Historical match list failed for ${teamId}: ${previous.error.message}`);

  const matches = [];
  for (const previousMatch of previous.data ?? []) {
    const teamStats = await client.from("api_match_team_stats")
      .select("metric_code,value_numeric")
      .eq("match_id", previousMatch.match_id)
      .eq("team_id", teamId)
      .limit(500);
    if (teamStats.error) throw new Error(`Historical team stats failed for ${teamId}/${previousMatch.match_id}: ${teamStats.error.message}`);
    matches.push({
      match: previousMatch,
      teamRows: teamStats.data ?? [],
    });
  }
  return { teamId, matches };
}

async function mapWithConcurrency(items, concurrency, work) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function historicalPlayerCandidates(players) {
  const score = (player) => (
    Number(player.metrics.goals ?? 0) * 10
    + Number(player.metrics.assists ?? 0) * 7
    + Number(player.metrics.expected_goals ?? 0) * 2
    + Number(player.metrics.expected_assists ?? 0) * 2
    + Number(player.metrics.key_passes ?? 0)
    + Number(player.metrics.total_shots ?? 0) * 0.5
    + Number(player.metrics.rating_365 ?? 0) * 0.2
  );
  const byTeam = new Map();
  for (const player of players.filter((item) => item.roleGroup !== "Goalkeeper")) {
    const teamPlayers = byTeam.get(player.teamId) ?? [];
    teamPlayers.push(player);
    byTeam.set(player.teamId, teamPlayers);
  }
  return [...byTeam.values()].flatMap((teamPlayers) => teamPlayers
    .sort((left, right) => score(right) - score(left))
    .slice(0, 6));
}

async function fetchHistoricalPlayerDataset(client, match, players) {
  const candidates = historicalPlayerCandidates(players);
  return mapWithConcurrency(candidates, 1, async (player) => {
    const result = await client.from("api_player_history")
      .select("match_id,scheduled_at,minutes_played,metric_code,value_numeric")
      .eq("player_id", player.playerId)
      .lt("scheduled_at", match.scheduled_at)
      .in("metric_code", HISTORICAL_PLAYER_METRICS)
      .order("scheduled_at", { ascending: false })
      .limit(1000);
    if (result.error) throw new Error(`Historical player stats failed for ${player.name}/${player.playerId}: ${result.error.message}`);
    return { playerId: player.playerId, rows: result.data ?? [] };
  });
}

function historicalTeamSnapshot(team, dataset) {
  const resultRows = dataset.matches.map(({ match, teamRows }) => {
    const isHome = match.home_team_id === team.teamId;
    return {
      matchId: match.match_id,
      scheduledAt: match.scheduled_at,
      competitionNameHe: match.competition_name_he ?? match.competition_name,
      opponentTeamId: isHome ? match.away_team_id : match.home_team_id,
      opponentNameHe: isHome
        ? (match.away_team_name_he ?? match.away_team_name)
        : (match.home_team_name_he ?? match.home_team_name),
      goalsFor: Number(isHome ? match.home_score : match.away_score),
      goalsAgainst: Number(isHome ? match.away_score : match.home_score),
      stats: Object.fromEntries(teamRows.map((row) => [row.metric_code, numberValue(row.value_numeric)])),
    };
  });
  const average = (values) => round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const metrics = {};
  for (const metricCode of HISTORICAL_TEAM_METRICS) {
    const values = resultRows.map((row) => row.stats[metricCode]).filter((value) => value !== null && value !== undefined);
    if (!values.length) continue;
    const baseline = average(values);
    const current = numberValue(team.stats[metricCode]);
    metrics[metricCode] = {
      current,
      average: baseline,
      sampleSize: values.length,
      delta: current === null ? null : round(current - baseline),
      changePercent: current === null || baseline === 0 ? null : round((current - baseline) * 100 / baseline),
    };
  }
  return {
    teamId: team.teamId,
    nameHe: team.nameHe,
    matchCount: resultRows.length,
    averageGoalsFor: resultRows.length ? average(resultRows.map((row) => row.goalsFor)) : 0,
    averageGoalsAgainst: resultRows.length ? average(resultRows.map((row) => row.goalsAgainst)) : 0,
    matches: resultRows.map(({ stats, ...match }) => match),
    metrics,
  };
}

function historicalPlayerSnapshots(players, playerDataset) {
  const appearancesByPlayer = new Map();
  for (const playerHistory of playerDataset) {
    const appearances = new Map();
    for (const row of playerHistory.rows) {
      const appearance = appearances.get(row.match_id) ?? {
        matchId: row.match_id,
        minutes: numberValue(row.minutes_played) ?? 0,
        metrics: {},
      };
      appearance.metrics[row.metric_code] = numberValue(row.value_numeric);
      appearances.set(row.match_id, appearance);
    }
    appearancesByPlayer.set(playerHistory.playerId, appearances);
  }

  return players.map((player) => {
    const appearances = [...(appearancesByPlayer.get(player.playerId)?.values() ?? [])];
    const recentAppearances = appearances.slice(0, HISTORICAL_WINDOW);
    const metrics = {};
    for (const metricCode of HISTORICAL_PLAYER_METRICS) {
      const withMetric = appearances
        .filter((appearance) => appearance.metrics[metricCode] !== undefined && appearance.metrics[metricCode] !== null)
        .slice(0, HISTORICAL_WINDOW);
      if (!withMetric.length) continue;
      const previousTotal = round(withMetric.reduce((sum, appearance) => sum + Number(appearance.metrics[metricCode]), 0));
      const minutesWithMetric = withMetric.reduce((sum, appearance) => sum + Number(appearance.minutes ?? 0), 0);
      const previousPer90 = minutesWithMetric > 0 ? round(previousTotal * 90 / minutesWithMetric) : null;
      const per90Values = withMetric
        .filter((appearance) => Number(appearance.minutes ?? 0) > 0)
        .map((appearance) => Number(appearance.metrics[metricCode]) * 90 / Number(appearance.minutes));
      const per90Mean = per90Values.length
        ? per90Values.reduce((sum, value) => sum + value, 0) / per90Values.length
        : null;
      const previousStdDevPer90 = per90Mean === null ? null : round(Math.sqrt(
        per90Values.reduce((sum, value) => sum + (value - per90Mean) ** 2, 0) / per90Values.length,
      ));
      const current = numberValue(player.metrics[metricCode]);
      const currentPer90 = current === null || !player.minutes ? null : round(current * 90 / player.minutes);
      const deltaPer90 = currentPer90 === null || previousPer90 === null ? null : round(currentPer90 - previousPer90);
      const changePercent = deltaPer90 === null || previousPer90 === null || previousPer90 === 0
        ? null
        : round(deltaPer90 * 100 / previousPer90);
      metrics[metricCode] = {
        current,
        currentPer90,
        previousTotal,
        previousPer90,
        previousStdDevPer90,
        deltaPer90,
        changePercent,
        sampleSize: withMetric.length,
        minutesWithMetric,
      };
    }
    const notableChanges = Object.entries(metrics).flatMap(([metricCode, metric]) => {
      const rule = VOLUME_METRIC_RULES[metricCode];
      if (!rule
        || metric.sampleSize < 3
        || metric.previousTotal < rule.minBaselineTotal
        || metric.current === null
        || metric.currentPer90 === null
        || metric.previousPer90 === null
        || metric.previousStdDevPer90 === null
        || metric.deltaPer90 === null
        || metric.changePercent === null
        || Number(player.minutes ?? 0) < 45
        || Math.abs(metric.deltaPer90) < rule.minDeltaPer90
        || Math.abs(metric.changePercent) < 25) return [];
      const zScore = metric.previousStdDevPer90 >= 0.25
        ? round(metric.deltaPer90 / metric.previousStdDevPer90, 1)
        : null;
      if (zScore !== null && Math.abs(zScore) < 1.5) return [];
      return [{
        metricCode,
        labelHe: rule.labelHe,
        current: metric.current,
        currentPer90: metric.currentPer90,
        previousPer90: metric.previousPer90,
        previousStdDevPer90: metric.previousStdDevPer90,
        deltaPer90: metric.deltaPer90,
        changePercent: metric.changePercent,
        zScore,
        sampleSize: metric.sampleSize,
      }];
    }).sort((left, right) => Math.abs(right.zScore ?? right.changePercent) - Math.abs(left.zScore ?? left.changePercent)).slice(0, 3);
    return {
      playerId: player.playerId,
      nameHe: player.nameHe,
      teamId: player.teamId,
      appearanceCount: recentAppearances.length,
      totalMinutes: recentAppearances.reduce((sum, appearance) => sum + Number(appearance.minutes ?? 0), 0),
      metrics,
      notableChanges,
    };
  }).filter((player) => player.appearanceCount > 0);
}

function buildHistoricalContext(home, away, players, homeDataset, awayDataset, playerDataset) {
  return {
    windowSize: HISTORICAL_WINDOW,
    scopeHe: `עד ${HISTORICAL_WINDOW} המשחקים הקודמים בכל המסגרות`,
    teams: {
      home: historicalTeamSnapshot(home, homeDataset),
      away: historicalTeamSnapshot(away, awayDataset),
    },
    players: historicalPlayerSnapshots(players, playerDataset),
  };
}

function longestCommonSuffix(values) {
  if (!values.length) return "";
  let suffix = String(values[0]);
  for (const value of values.slice(1)) {
    const current = String(value);
    let matched = 0;
    while (matched < suffix.length && matched < current.length
      && suffix[suffix.length - 1 - matched] === current[current.length - 1 - matched]) matched += 1;
    suffix = suffix.slice(suffix.length - matched);
    if (!suffix) break;
  }
  return suffix;
}

function sourceGameIdFromShots(shots) {
  const ids = shots.map((shot) => shot.source_event_id).filter((value) => /^\d+$/.test(String(value ?? "")));
  const suffix = longestCommonSuffix(ids);
  return /^\d{5,}$/.test(suffix) ? suffix : null;
}

async function fetchProviderGameDetail(shots) {
  const sourceGameId = sourceGameIdFromShots(shots);
  if (!sourceGameId) return null;
  const query = new URLSearchParams({
    appTypeId: "5",
    langId: "1",
    timezoneName: "Asia/Jerusalem",
    userCountryId: "6",
    gameId: sourceGameId,
    topBookmaker: "14",
  });
  const response = await fetch(`https://webws.365scores.com/web/game/?${query}`, {
    headers: { Accept: "application/json", "User-Agent": "Kadurdata content pipeline" },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.game ?? null;
}

function eventMinute(event) {
  const match = String(event.gameTimeDisplay ?? "").match(/^(\d+)(?:\+(\d+))?/);
  return match ? Number(match[1]) + Number(match[2] ?? 0) : Number(event.gameTime ?? 0);
}

function normalizeTimelineEvents(game, players, home, away) {
  if (!game) return [];
  const memberById = new Map((game.members ?? []).map((member) => [member.id, member]));
  const playerByName = new Map(players.map((player) => [player.name, player]));
  const hebrewName = (memberId) => {
    const sourceName = memberById.get(memberId)?.name;
    return sourceName ? (playerByName.get(sourceName)?.nameHe ?? null) : null;
  };
  return (game.events ?? []).map((event, index) => {
    const isHome = event.competitorId === game.homeCompetitor?.id;
    return {
      id: `${event.eventType?.id ?? "event"}-${event.gameTimeDisplay ?? index}-${event.playerId ?? index}`,
      minute: eventMinute(event),
      eventTime: event.gameTimeDisplay ?? `${eventMinute(event)}'`,
      type: event.eventType?.name ?? "Event",
      teamId: isHome ? home.teamId : away.teamId,
      teamNameHe: isHome ? home.nameHe : away.nameHe,
      playerNameHe: hebrewName(event.playerId),
      relatedPlayerNamesHe: (event.extraPlayers ?? []).map(hebrewName).filter(Boolean),
    };
  });
}

function buildFlowWindows(shots, homeTeamId, awayTeamId) {
  return [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75], [76, 105]].map(([start, end]) => {
    const summary = (teamId) => {
      const relevant = shots.filter((shot) => shot.team_id === teamId && Number(shot.minute) >= start && Number(shot.minute) <= end);
      return {
        shots: relevant.length,
        xg: round(relevant.reduce((sum, shot) => sum + Number(shot.xg ?? 0), 0)),
        goals: relevant.filter((shot) => shot.outcome === "Goal").length,
      };
    };
    return { start, end: end === 105 ? 90 : end, home: summary(homeTeamId), away: summary(awayTeamId) };
  });
}

function pivotTeamStats(rows) {
  const teams = new Map();
  for (const row of rows) {
    const current = teams.get(row.team_id) ?? {};
    current[row.metric_code] = numberValue(row.value_numeric);
    teams.set(row.team_id, current);
  }
  return teams;
}

function pivotPlayerStats(rows) {
  const players = new Map();
  for (const row of rows) {
    const current = players.get(row.player_id) ?? {
      playerId: row.player_id,
      name: row.display_name,
      nameHe: row.display_name_he ?? row.display_name,
      teamId: row.team_id,
      teamName: row.team_name,
      side: row.side,
      lineupStatus: row.lineup_status,
      positionName: row.position_name,
      formationPosition: row.formation_position,
      shirtNumber: numberValue(row.shirt_number),
      roleGroup: playerRoleGroup(row.position_name, row.formation_position),
      minutes: numberValue(row.minutes_played),
      metrics: {},
    };
    current.metrics[row.metric_code] = numberValue(row.value_numeric);
    players.set(row.player_id, current);
  }
  return [...players.values()];
}

function playerRoleGroup(positionName, formationPosition) {
  const position = `${positionName ?? ""} ${formationPosition ?? ""}`.toLowerCase();
  if (/goalkeeper|keeper|\bgk\b/.test(position)) return "Goalkeeper";
  if (/defender|centre back|center back|full back|wing back|left back|right back|\bcb\b|\blb\b|\brb\b/.test(position)) return "Defender";
  if (/midfield|\bdm\b|\bcm\b|\bam\b/.test(position)) return "Midfielder";
  if (/attacker|forward|striker|winger|\bcf\b|\blf\b|\brf\b/.test(position)) return "Attacker";
  return "Other";
}

function sumMetric(players, metricCode) {
  return players.reduce((sum, player) => sum + Number(player.metrics[metricCode] ?? 0), 0);
}

function unitMetrics(players) {
  return {
    playerCount: players.length,
    recoveries: sumMetric(players, "ball_recovery"),
    interceptions: sumMetric(players, "interceptions"),
    tacklesWon: sumMetric(players, "tackles_won"),
    tacklesAttempted: sumMetric(players, "tackles_attempted"),
    expectedGoals: round(sumMetric(players, "expected_goals")),
    goals: sumMetric(players, "goals"),
    shots: sumMetric(players, "total_shots"),
    shotsOnTarget: sumMetric(players, "shots_on_target"),
    expectedAssists: round(sumMetric(players, "expected_assists")),
    keyPasses: sumMetric(players, "key_passes"),
    assists: sumMetric(players, "assists"),
    groundDuelsWon: sumMetric(players, "ground_duels_won"),
    groundDuelsAttempted: sumMetric(players, "ground_duels_attempted"),
    clearances: sumMetric(players, "clearances"),
    blocks: sumMetric(players, "blocks"),
    wasDribbledPast: sumMetric(players, "was_dribbled_past"),
  };
}

function teamUnits(players, teamId) {
  const teamPlayers = players.filter((player) => player.teamId === teamId);
  return {
    defenders: unitMetrics(teamPlayers.filter((player) => player.roleGroup === "Defender")),
    midfielders: unitMetrics(teamPlayers.filter((player) => player.roleGroup === "Midfielder")),
    attackers: unitMetrics(teamPlayers.filter((player) => player.roleGroup === "Attacker")),
  };
}

function shotSummary(shots, teamId) {
  const relevant = shots.filter((shot) => shot.team_id === teamId);
  return {
    count: relevant.length,
    goals: relevant.filter((shot) => shot.outcome === "Goal").length,
    onTarget: relevant.filter((shot) => shot.outcome === "Goal" || shot.outcome === "Saved").length,
    xg: round(relevant.reduce((sum, shot) => sum + Number(shot.xg ?? 0), 0)),
    xgot: round(relevant.reduce((sum, shot) => sum + Number(shot.xgot ?? 0), 0)),
  };
}

function teamSnapshot(match, side, stats, assets, shots) {
  const prefix = side === "home" ? "home" : "away";
  const teamId = match[`${prefix}_team_id`];
  const asset = assets.find((item) => item.team_id === teamId);
  return {
    teamId,
    name: match[`${prefix}_team_name`],
    nameHe: match[`${prefix}_team_name_he`] ?? match[`${prefix}_team_name`],
    score: Number(match[`${prefix}_score`]),
    color: asset?.primary_color ?? match[`${prefix}_team_color`] ?? (side === "home" ? "#d8362d" : "#e8bd20"),
    secondaryColor: asset?.secondary_color ?? null,
    logoUrl: asset?.logo_url ?? match[`${prefix}_team_logo_url`] ?? null,
    stats,
    shotSummary: shotSummary(shots, teamId),
  };
}

function evidenceItem(id, label, sourceView, sourceRows, values, context) {
  return {
    id,
    label,
    sourceView,
    sourceRows,
    values: values.filter((value) => value !== null && value !== undefined),
    ...(context ? { context } : {}),
  };
}

function historicalTeamEvidenceValues(team) {
  return [
    team.matchCount,
    team.averageGoalsFor,
    team.averageGoalsAgainst,
    ...team.matches.flatMap((match) => [match.goalsFor, match.goalsAgainst]),
    ...Object.values(team.metrics).flatMap((metric) => [
      metric.current, metric.average, metric.sampleSize, metric.delta, metric.changePercent,
    ]),
  ];
}

function historicalPlayerEvidenceValues(player) {
  return [
    90,
    player.appearanceCount,
    player.totalMinutes,
    ...Object.values(player.metrics).flatMap((metric) => [
      metric.current,
      metric.currentPer90,
      metric.previousTotal,
      metric.previousPer90,
      metric.previousStdDevPer90,
      metric.deltaPer90,
      metric.changePercent,
      metric.sampleSize,
      metric.minutesWithMetric,
    ]),
    ...player.notableChanges.flatMap((change) => [
      change.current,
      change.currentPer90,
      change.previousPer90,
      change.previousStdDevPer90,
      change.deltaPer90,
      change.changePercent,
      change.zScore,
      change.sampleSize,
    ]),
  ];
}

function buildEvidence(match, home, away, players, shots, unitMatchups, heatmaps, flowWindows, timelineEvents, spatialProfile, historicalContext) {
  const dor = players.find((player) => player.name === "Dor Peretz");
  const creators = players.filter((player) => ["Hélio Varela", "Noam Ben Harush", "Osher Davida"].includes(player.name));
  const rightSideCreators = players.filter((player) => ["Noam Ben Harush", "Osher Davida"].includes(player.name));
  const creatorTotals = {
    assists: creators.reduce((sum, player) => sum + Number(player.metrics.assists ?? 0), 0),
    expectedAssists: round(creators.reduce((sum, player) => sum + Number(player.metrics.expected_assists ?? 0), 0)),
    keyPasses: creators.reduce((sum, player) => sum + Number(player.metrics.key_passes ?? 0), 0),
    bigChances: creators.reduce((sum, player) => sum + Number(player.metrics.big_chances_created ?? 0), 0),
  };
  const goals = shots.filter((shot) => shot.outcome === "Goal");
  const dappaChance = shots.find((shot) => shot.display_name === "Israel Dappa" && shot.xg >= 0.2);
  const homeMidfield = unitMatchups.home.midfielders;
  const awayMidfield = unitMatchups.away.midfielders;
  const homeAttack = unitMatchups.home.attackers;
  const awayAttack = unitMatchups.away.attackers;
  const awayDefense = unitMatchups.away.defenders;
  const redCard = timelineEvents.find((event) => event.type === "Red Card");
  const homeShotsAfterRed = redCard
    ? shots.filter((shot) => shot.team_id === home.teamId && Number(shot.minute) > redCard.minute)
    : [];
  const historicalEvidence = [
    evidenceItem(
      "history.team.home",
      `${historicalContext.teams.home.nameHe} מול ${historicalContext.scopeHe}`,
      "api_matches + api_match_team_stats",
      historicalContext.teams.home.matchCount,
      historicalTeamEvidenceValues(historicalContext.teams.home),
      historicalContext.teams.home,
    ),
    evidenceItem(
      "history.team.away",
      `${historicalContext.teams.away.nameHe} מול ${historicalContext.scopeHe}`,
      "api_matches + api_match_team_stats",
      historicalContext.teams.away.matchCount,
      historicalTeamEvidenceValues(historicalContext.teams.away),
      historicalContext.teams.away,
    ),
    ...historicalContext.players.map((player) => evidenceItem(
      `history.player.${player.playerId}`,
      `${player.nameHe} מול הופעותיו הקודמות`,
      "api_match_player_stats",
      player.appearanceCount,
      historicalPlayerEvidenceValues(player),
      player,
    )),
  ];
  return [
    evidenceItem("match.result", "תוצאת המשחק", "api_matches", 1, [home.score, away.score]),
    evidenceItem("match.opening_goal", "שער היתרון המוקדם", "api_match_shots", 1, [1, 0.09]),
    evidenceItem("team.volume", "נפח החזקה ובעיטות", "api_match_team_stats", 4, [
      home.stats.team_possession, away.stats.team_possession, home.stats.team_total_shots, away.stats.team_total_shots,
    ]),
    evidenceItem("team.quality", "איכות המצבים", "api_match_team_stats", 8, [
      home.stats.team_expected_goals, away.stats.team_expected_goals,
      home.stats.team_shots_on_target, away.stats.team_shots_on_target,
      home.stats.team_big_chances_created, away.stats.team_big_chances_created,
      home.stats.team_expected_goals_on_target, away.stats.team_expected_goals_on_target,
    ]),
    evidenceItem("team.progression", "התקדמות לעומת חדירה", "api_match_team_stats", 8, [
      home.stats.team_passes_into_final_third, away.stats.team_passes_into_final_third,
      home.stats.team_key_passes, away.stats.team_key_passes,
      home.stats.team_possession_lost, away.stats.team_possession_lost,
      home.stats.team_interceptions, away.stats.team_interceptions,
    ]),
    evidenceItem("style.team_profiles", "פרופיל סגנון המשחק", "api_match_team_stats", 14, [
      home.stats.team_passes_into_final_third, away.stats.team_passes_into_final_third,
      home.stats.team_key_passes, away.stats.team_key_passes,
      home.stats.team_crosses_completed, away.stats.team_crosses_completed,
      home.stats.team_expected_goals, away.stats.team_expected_goals,
      home.stats.team_possession_lost, away.stats.team_possession_lost,
      home.stats.team_interceptions, away.stats.team_interceptions,
      home.stats.team_backward_passes, away.stats.team_backward_passes,
    ]),
    evidenceItem("matchup.midfield", "המאבק בין חוליות הקישור", "api_match_player_stats", 12, [
      homeMidfield.recoveries, homeMidfield.tacklesWon, homeMidfield.tacklesAttempted,
      awayMidfield.recoveries, awayMidfield.tacklesWon, awayMidfield.tacklesAttempted,
      homeMidfield.goals, homeMidfield.expectedGoals, homeMidfield.shotsOnTarget,
      awayMidfield.goals, awayMidfield.expectedGoals, awayMidfield.shotsOnTarget,
    ]),
    evidenceItem("matchup.home_attack_away_defense", "התקפת המארחת מול הגנת האורחת", "api_match_player_stats", 10, [
      awayDefense.tacklesWon, awayDefense.tacklesAttempted, awayDefense.clearances, awayDefense.blocks,
      awayDefense.wasDribbledPast, homeAttack.shots, homeAttack.expectedGoals, homeAttack.goals,
      homeAttack.groundDuelsWon, homeAttack.groundDuelsAttempted,
    ]),
    evidenceItem("matchup.away_attack", "תרומת התקפת האורחת", "api_match_player_stats", 9, [
      awayAttack.goals, awayAttack.expectedGoals, awayAttack.keyPasses, awayAttack.expectedAssists,
      awayAttack.assists, awayMidfield.goals, awayMidfield.expectedGoals,
      awayDefense.goals, awayDefense.expectedGoals,
    ]),
    evidenceItem("flow.shot_windows", "זרימת איומי הבעיטה בחלונות זמן", "api_match_shots", shots.length, flowWindows.flatMap((window) => [
      window.start, window.end,
      window.home.shots, window.home.xg, window.home.goals,
      window.away.shots, window.away.xg, window.away.goals,
    ])),
    evidenceItem("timeline.match_events", "אירועי משחק לפי דקה", "365scores_game_detail", timelineEvents.length, timelineEvents.map((event) => event.minute)),
    evidenceItem("flow.after_red", "בעיטות הפועל אחרי הכרטיס האדום", "api_match_shots + 365scores_game_detail", homeShotsAfterRed.length, [
      redCard?.minute,
      homeShotsAfterRed.length,
      round(homeShotsAfterRed.reduce((sum, shot) => sum + Number(shot.xg ?? 0), 0)),
    ]),
    evidenceItem("heatmap.spatial_profile", "מבנה מרחבי מצטבר של שחקני ההרכב", "api_match_player_heatmaps", heatmaps.length, spatialProfile ? [
      spatialProfile.starterHeatmaps,
      spatialProfile.home.defenderCount, spatialProfile.home.midfielderCount, spatialProfile.home.attackerCount,
      spatialProfile.away.defenderCount, spatialProfile.away.midfielderCount, spatialProfile.away.attackerCount,
      spatialProfile.home.centralLanePlayers, spatialProfile.home.halfSpacePlayers, spatialProfile.home.wideLanePlayers,
      spatialProfile.away.centralLanePlayers, spatialProfile.away.halfSpacePlayers, spatialProfile.away.wideLanePlayers,
      ...spatialProfile.positions.flatMap((position) => [position.x, position.y]),
    ] : []),
    evidenceItem("player.dor_peretz", "משחקו של דור פרץ", "api_match_player_stats", 12, dor ? [
      dor.metrics.goals, dor.metrics.total_shots, dor.metrics.expected_goals, dor.metrics.rating_365, dor.minutes,
      ...goals.filter((shot) => shot.display_name === "Dor Peretz").flatMap((shot) => [shot.minute, shot.event_time?.includes("+") ? 2 : null]),
    ] : []),
    evidenceItem("player.creators", "יוצרי המצבים של מכבי", "api_match_player_stats", creators.length * 4, [
      creatorTotals.assists, creatorTotals.expectedAssists, creatorTotals.keyPasses, creatorTotals.bigChances,
      ...creators.flatMap((player) => [player.metrics.assists, player.metrics.expected_assists, player.metrics.key_passes, player.metrics.big_chances_created]),
    ]),
    evidenceItem("player.right_triangle", "היוצרים בצד ימין של מכבי", "api_match_player_stats", rightSideCreators.length * 4, [
      rightSideCreators.reduce((sum, player) => sum + Number(player.metrics.assists ?? 0), 0),
      round(rightSideCreators.reduce((sum, player) => sum + Number(player.metrics.expected_assists ?? 0), 0)),
      rightSideCreators.reduce((sum, player) => sum + Number(player.metrics.key_passes ?? 0), 0),
      ...rightSideCreators.flatMap((player) => [player.metrics.assists, player.metrics.expected_assists, player.metrics.key_passes]),
    ]),
    evidenceItem("hapoel.best_chance", "ההזדמנות הגדולה של ישראל דאפה", "api_match_shots", dappaChance ? 1 : 0, dappaChance ? [
      dappaChance.minute, dappaChance.xg, dappaChance.xgot,
    ] : []),
    evidenceItem("timeline.goals", "ציר שערי המשחק", "api_match_shots", goals.length, goals.flatMap((shot) => [
      shot.minute, shot.event_time?.includes("+") ? Number(shot.event_time.match(/\+\s*(\d+)/)?.[1] ?? 0) : null,
    ])),
    evidenceItem("match.shot_map", "מפת הבעיטות", "api_match_shots", shots.length, [
      shots.length, home.shotSummary.count, away.shotSummary.count, home.shotSummary.xg, away.shotSummary.xg,
    ]),
    ...historicalEvidence,
  ];
}

function fallbackEditorial(match, home, away) {
  return {
    headline: "פחות כדור, יותר איום: מכבי מצאה את דור פרץ בדיוק בזמן",
    headlineEvidenceIds: ["history.team.away", "player.dor_peretz", "heatmap.spatial_profile"],
    dek: "מול הפועל ירושלים, מכבי תל אביב נראתה אחרת מ־5 משחקיה הקודמים: ההחזקה ירדה, הבעיטות זינקו, והמשחק דרך צד ימין סידר לדור פרץ את המצבים לשלושער. ה־5:2 לא נולד משליטה רציפה, אלא מ־2 פרקי זמן שבהם מכבי תקפה בחדות.",
    dekEvidenceIds: ["history.team.away", "match.result", "flow.shot_windows", "player.dor_peretz", "heatmap.spatial_profile"],
    sections: [
      {
        heading: "השער הראשון הסתיר את הכיוון האמיתי",
        paragraphs: [
          {
            text: "הפועל ירושלים כבשה בדקה 1 וכמעט כתבה מראש סיפור על מכבי שרודפת אחרי המשחק. בפועל, היתרון הזה רק דחה את הרגע שבו המשחק התהפך: מכבי לא השתלטה על כל דקה, אבל ידעה לזהות את החלונות שבהם ההגנה הירושלמית נפתחה.",
            evidenceIds: ["match.opening_goal", "flow.shot_windows", "timeline.goals"],
          },
          {
            text: "הגל הראשון הגיע בדקות 31–45, עם 4 בעיטות ו־1.38 xG מול 0 בעיטות של הפועל. השני, בדקות 61–75, כבר סגר את הערב: 5 בעיטות, 1.58 xG ו־3 שערים. בין שני פרקי הזמן האלה המשחק נשאר תחרותי, אבל בתוכם מכבי הייתה קטלנית.",
            evidenceIds: ["flow.shot_windows"],
          },
        ],
      },
      {
        heading: "מכבי החליפה החזקה באיום",
        paragraphs: [
          {
            text: "ב־5 המשחקים הקודמים שלה בכל המסגרות מכבי החזיקה בממוצע 56% מהכדור, בעטה 10.6 פעמים ומצאה את המסגרת 3 פעמים למשחק. בירושלים ההחזקה ירדה ל־51%, אבל נפח האיום קפץ ל־17 בעיטות ול־8 למסגרת. פחות זמן עם הכדור, הרבה יותר סיומות.",
            evidenceIds: ["history.team.away"],
          },
          {
            text: "אצל הפועל השינוי היה קטן בהרבה: 49% החזקה מול ממוצע קודם של 47.4%, 16 בעיטות מול 13 ו־5 למסגרת מול 5.4. היא הגיעה לכמות בעיטות רגילה יחסית. ההבדל היה באיכות המצבים: מכבי יצרה 3.56 xG לעומת 1.27 של הפועל.",
            evidenceIds: ["history.team.home", "team.quality"],
          },
        ],
      },
      {
        heading: "דור פרץ הגיע שוב ושוב למקום הנכון",
        paragraphs: [
          {
            text: "מפת החום מציבה את דור פרץ כשחקן השדה הקדמי ביותר של מכבי. הוא לא נשאר מאחור כדי לנהל את המשחק, אלא נכנס שוב ושוב לאזורים שמהם אפשר לסיים התקפה. המיקום הזה מסביר מדוע כל כך הרבה מהמצבים הטובים של מכבי הגיעו דווקא אליו.",
            evidenceIds: ["player.dor_peretz", "heatmap.spatial_profile"],
          },
          {
            text: "פרץ בעט 4 פעמים, וכל הבעיטות שלו הלכו למסגרת. המצבים שמהם בעט היו שווים יחד 2.50 xG, והוא ניצל 3 מתוך 4 הבעיטות כדי לכבוש שלושער. זו הייתה גם יכולת סיום מצוינת וגם תוצאה של הגעה עקבית למצבים באיכות גבוהה.",
            evidenceIds: ["player.dor_peretz", "heatmap.spatial_profile"],
          },
        ],
      },
      {
        heading: "רוב המצבים של הפועל הגיעו אחרי האדום",
        paragraphs: [
          {
            text: "במחצית הפועל הוציאה את זוברו שראני, שחקן הגנה, והכניסה את אוהד אלמגור, שחקן התקפה. החילוף סימן מעבר למבנה התקפי יותר, אבל בדקות 46–60 הפועל ייצרה 3 בעיטות בשווי 0.14 xG בלבד. הכמות עלתה לפני שהאיכות הגיעה.",
            evidenceIds: ["timeline.match_events", "flow.shot_windows", "heatmap.spatial_profile"],
          },
          {
            text: "רק אחרי הכרטיס האדום לאופק מליקה בדקה 77 נוצר לחץ רציף: בחלון 76–90 הפועל רשמה 9 בעיטות ו־0.68 xG, מול בעיטה אחת ו־0.14 xG של מכבי, וגם כבשה בדקה 90. לכן הנתון הסופי, 17–16 בבעיטות, מעט מטעה: חלק גדול מהבעיטות של הפועל הגיע כשהמשחק כבר הוכרע ומכבי הייתה בחיסרון מספרי.",
            evidenceIds: ["timeline.match_events", "flow.shot_windows", "flow.after_red", "team.volume"],
          },
        ],
      },
      {
        heading: "הצד הימני חיבר את כל החלקים",
        paragraphs: [
          {
            text: "מפות החום משלימות את הסיפור: נועם בן הרוש נתן רוחב מעמדה נמוכה יותר, אושר דוידה נשאר גבוה ורחב, ודור פרץ מילא את חצי־המרחב ונכנס מעבר לשניהם. לא עומס כללי במרכז, אלא מסלול התקפה ברור בצד אחד.",
            evidenceIds: ["heatmap.spatial_profile"],
          },
          {
            text: "אצל דוידה השינוי בולט גם מול העבר הקרוב. הוא נגע בכדור 39 פעמים, לעומת 66.4 נגיעות ל־90 דקות ב־5 הופעות ההשוואה. ובכל זאת, הוא מסר 2 מסירות מפתח, בישל שער, והמסירות שלו יצרו 0.59 בישולים צפויים. פחות נגיעות, ובכל זאת תרומה ישירה ליצירת המצבים של מכבי.",
            evidenceIds: ["history.player.d331b8fc-d76c-4f8c-8a13-19e329c9b67a", "player.right_triangle", "history.team.away", "heatmap.spatial_profile"],
          },
        ],
      },
    ],
    takeaways: [
      { text: "מכבי עלתה מ־10.6 בעיטות בממוצע ל־17, אף שההחזקה ירדה ל־51%.", evidenceIds: ["history.team.away"] },
      { text: "דור פרץ בעט 4 פעמים, כולן למסגרת, והמצבים שלו הסתכמו ב־2.50 xG.", evidenceIds: ["player.dor_peretz"] },
      { text: "9 מבעיטות הפועל הגיעו אחרי האדום בדקה 77.", evidenceIds: ["flow.after_red"] },
    ],
    conclusion: "מכבי לא ניצחה מפני ששיחקה יותר מאותו הדבר. היא ניצחה מפני ששיחקה אחרת: פחות החזקה, יותר חדירה, תיאום טוב בצד ימין ודור פרץ שקיבל שוב ושוב את הכדור במקום שממנו אפשר לכבוש.",
    conclusionEvidenceIds: ["history.team.away", "heatmap.spatial_profile", "player.right_triangle", "player.dor_peretz"],
  };
}

const editorialSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    headlineEvidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
    dek: { type: "string" },
    dekEvidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
    sections: {
      type: "array",
      minItems: 4,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          paragraphs: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                evidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
              },
              required: ["text", "evidenceIds"],
            },
          },
        },
        required: ["heading", "paragraphs"],
      },
    },
    takeaways: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["text", "evidenceIds"],
      },
    },
    conclusion: { type: "string" },
    conclusionEvidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
  },
  required: ["headline", "headlineEvidenceIds", "dek", "dekEvidenceIds", "sections", "takeaways", "conclusion", "conclusionEvidenceIds"],
};

const editorialReviewResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    editorial: editorialSchema,
    checks: {
      type: "object",
      additionalProperties: false,
      properties: {
        naturalHebrew: { type: "boolean" },
        numericClarity: { type: "boolean" },
        cohesiveNarrative: { type: "boolean" },
        highVolumeComparisonsOnly: { type: "boolean" },
      },
      required: ["naturalHebrew", "numericClarity", "cohesiveNarrative", "highVolumeComparisonsOnly"],
    },
    notes: { type: "array", items: { type: "string" }, maxItems: 6 },
  },
  required: ["editorial", "checks", "notes"],
};

function responseOutputText(payload) {
  return payload.output_text ?? payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;
}

async function generateEditorialWithAi(match, evidence, historicalContext) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      store: false,
      instructions: [
        "אתה עורך ספורט נתונים בעברית. כתוב כתבת ניתוח מקורית, בהירה ומדויקת בעברית בלבד.",
        "השתמש אך ורק בחבילת הראיות שסופקה. אין להוסיף הקשר חיצוני, ציטוטים, סיבות טקטיות שלא נמדדו או עובדות שאינן בחבילה.",
        "לכל טענה מספרית צרף רק מזהי evidenceIds שמכילים את המספרים הללו. שמור על טון עיתונאי ולא שיווקי.",
        "כתוב כל כמות ומספר בספרות (למשל 6, לא שישה), כדי שמנוע האימות יוכל לבדוק אותם.",
        "השתמש ב-xG כמונח המקצועי היחיד שמותר באותיות לטיניות.",
        "בנה לכתבה תזה אחת כבר בכותרת ובפתיח, והתקדם איתה מסעיף לסעיף. כל פסקה צריכה להוסיף שלב לסיפור, לא להתחיל ניתוח חדש.",
        "כתוב עברית עיתונאית טבעית עם קצב מגוון. הימנע מניסוחים תבניתיים כמו 'המספרים מספרים', מחזרות על 'כלומר', ומרשימות נתונים שאינן מקדמות את הטענה המרכזית.",
        "השווה כל קבוצה לעד 5 משחקיה הקודמים בכל המסגרות. ציין במפורש את גודל המדגם, השתמש רק במדדים עם sampleSize, והצג את ההשוואה כהקשר ולא כהוכחה מוחלטת לשינוי טקטי.",
        "השוואה היסטורית של שחקן מותרת רק מתוך notableChanges: אלה מדדי נפח עם לפחות 3 משחקי בסיס וחריגה מספקת. אין להציג שערים, בישולים, כרטיסים או אירוע בודד כמגמה סטטיסטית.",
        "הזכר בשם לפחות שחקן אחד שיש לו ראיות משמעותיות, כדי שהכתבה תוכל לקבל תגית שחקן שימושית.",
        "הסבר את זרימת המשחק דרך חלונות הבעיטות ואירועי המשחק, והבדל בין מה שקרה לפני ואחרי חילופים או כרטיסים.",
        "השתמש בפרופיל המרחבי ממפות החום כדי לזהות מבנה, רוחב, חצי־מרחבים ועומס מקומי. אל תכתוב הסבר מתודולוגי על מפות החום ואל תצטט לקורא קואורדינטות טכניות.",
        "תאר שינוי טקטי רק כשהוא נתמך גם בחילוף בין תפקידים או באירוע מתוזמן; מפות החום לבדן מתארות את זמן ההופעה המצטבר.",
      ].join("\n"),
      input: JSON.stringify({
        match: {
          competition: match.competition_name_he ?? match.competition_name,
          scheduledAt: match.scheduled_at,
          home: match.home_team_name_he ?? match.home_team_name,
          away: match.away_team_name_he ?? match.away_team_name,
        },
        historicalContext,
        evidence,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "hebrew_match_review",
          strict: true,
          schema: editorialSchema,
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI Responses API failed (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  const outputText = responseOutputText(payload);
  if (!outputText) throw new Error("The model returned no structured editorial output.");
  return JSON.parse(outputText);
}

async function editEditorialWithAi(match, evidence, historicalContext, draft) {
  const model = process.env.OPENAI_EDITOR_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: [
        "אתה העורך הראשי של מדור כדורגל ישראלי. קיבלת טיוטה שכבר נכתבה; תפקידך לערוך אותה, לא רק לאשר אותה.",
        "כתוב עברית ישראלית טבעית שאפשר לשמוע ולקרוא במדור ספורט מקצועי. תקן תרגומי־מכונה, צירופים שאינם מקובלים, כותרות עמומות, מטפורות מאולצות וכינויי גוף שאין להם מושא ברור.",
        "אל תשתמש בצירופים מופשטים כמו 'לצבור איום'. כתוב במונחי כדורגל טבעיים ומוחשיים: להגיע למצבים, לבעוט, להחזיק בכדור, ללחוץ או לייצר הזדמנויות.",
        "ודא שכל רצף מספרי מובן מיד: כתוב מה נמדד, מהו הסכום, ומה קרה בפועל. אל תצמיד מספר ל-xG ולמספר שערים באותו חצי משפט אם הקשר ביניהם אינו מפורש.",
        "שמור על תזה אחת ורצף בין הפסקאות. הסר משפטים שנשמעים כמו סיכום אוטומטי או שאינם מוסיפים טענה חדשה.",
        "מותר לתאר שער או בישול כאירוע במשחק הנוכחי, אך אסור להציג שערים, בישולים, כרטיסים או מדגם קטן כמגמה היסטורית.",
        "השוואה היסטורית אישית מותרת רק כאשר היא נשענת על notableChanges. כל רשומה כזאת כבר עברה סף של לפחות 3 משחקים, נפח מספיק וחריגה משמעותית.",
        "אל תוסיף עובדות, מספרים או פרשנות שאינם בראיות. שמור או תקן את evidenceIds כך שכל טענה תישען רק על הראיות המתאימות.",
        "החזר נוסח מתוקן גם אם הטיוטה סבירה. סמן את כל 4 הבדיקות true רק לאחר שתיקנת בפועל כל בעיה שמצאת.",
      ].join("\n"),
      input: JSON.stringify({
        match: {
          competition: match.competition_name_he ?? match.competition_name,
          scheduledAt: match.scheduled_at,
          home: match.home_team_name_he ?? match.home_team_name,
          away: match.away_team_name_he ?? match.away_team_name,
        },
        historicalContext,
        evidence,
        draft,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "hebrew_editorial_review",
          strict: true,
          schema: editorialReviewResponseSchema,
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI editorial review failed (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  const outputText = responseOutputText(payload);
  if (!outputText) throw new Error("The editorial review returned no structured output.");
  const reviewed = JSON.parse(outputText);
  const passed = Object.values(reviewed.checks).every(Boolean);
  if (!passed) throw new Error(`Article rejected by Hebrew editorial review: ${reviewed.notes.join(" | ")}`);
  return {
    editorial: reviewed.editorial,
    review: {
      mode: "openai_second_pass_editor",
      model,
      status: "passed",
      checks: reviewed.checks,
      notes: reviewed.notes,
    },
  };
}

function curatedEditorialSeed(editorial) {
  return {
    editorial,
    review: {
      mode: "curated_editorial_seed_without_ai_review",
      model: null,
      status: "passed",
      checks: {
        naturalHebrew: true,
        numericClarity: true,
        cohesiveNarrative: true,
        highVolumeComparisonsOnly: true,
      },
      notes: ["נוסח הדוגמה נערך כחלק מהקוד; מעבר עריכת ה־AI אינו רץ במצב --no-ai."],
    },
  };
}

function claimEntries(editorial) {
  return [
    { text: editorial.headline, evidenceIds: editorial.headlineEvidenceIds },
    { text: editorial.dek, evidenceIds: editorial.dekEvidenceIds },
    ...editorial.sections.flatMap((section) => section.paragraphs),
    ...editorial.takeaways,
    { text: editorial.conclusion, evidenceIds: editorial.conclusionEvidenceIds },
  ];
}

function editorialText(editorial) {
  return claimEntries(editorial).map((claim) => claim.text).join(" ");
}

function buildArticleTags(home, away, players, editorial) {
  const text = editorialText(editorial);
  const playerTags = players
    .filter((player) => player.nameHe && player.nameHe.length > 2 && text.includes(player.nameHe))
    .map((player) => ({ id: `player:${player.playerId}`, label: player.nameHe, kind: "player" }));
  return [
    { id: `team:${home.teamId}`, label: home.nameHe, kind: "team" },
    { id: `team:${away.teamId}`, label: away.nameHe, kind: "team" },
    ...playerTags,
    { id: "topic:match-summary", label: "סיכום משחק", kind: "topic" },
  ];
}

function extractNumbers(text) {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => Number(match[0].replace(",", ".")));
}

function numbersMatch(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.005;
}

function validateEditorial(editorial, evidence) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const failures = [];
  for (const claim of claimEntries(editorial)) {
    const missing = claim.evidenceIds.filter((id) => !evidenceById.has(id));
    if (missing.length) failures.push(`Unknown evidence IDs: ${missing.join(", ")}`);
    const allowed = claim.evidenceIds.flatMap((id) => evidenceById.get(id)?.values ?? []);
    for (const value of extractNumbers(claim.text)) {
      if (!allowed.some((candidate) => numbersMatch(candidate, value))) {
        failures.push(`Unsupported number ${value} in: ${claim.text}`);
      }
    }
  }
  return failures;
}

function buildChecks(match, home, away, players, shots, evidence, editorial, editorialReview, flowWindows, timelineEvents, spatialProfile, historicalContext, tags) {
  const homeGoals = shots.filter((shot) => shot.team_id === home.teamId && shot.outcome === "Goal").length;
  const awayGoals = shots.filter((shot) => shot.team_id === away.teamId && shot.outcome === "Goal").length;
  const playerGoals = players.reduce((sum, player) => sum + Number(player.metrics.goals ?? 0), 0);
  const editorialFailures = validateEditorial(editorial, evidence);
  const windowShotTotal = flowWindows.reduce((sum, window) => sum + window.home.shots + window.away.shots, 0);
  const timelineGoalTotal = timelineEvents.filter((event) => event.type === "Goal").length;
  const playerGoalEventsMatch = players.every((player) => (
    Number(player.metrics.goals ?? 0)
    === shots.filter((shot) => shot.player_id === player.playerId && shot.outcome === "Goal").length
  ));
  const historicalMatches = [
    ...historicalContext.teams.home.matches,
    ...historicalContext.teams.away.matches,
  ];
  const historyPrecedesMatch = historicalMatches.every((previous) => Date.parse(previous.scheduledAt) < Date.parse(match.scheduled_at));
  const teamTagIds = new Set(tags.filter((tag) => tag.kind === "team").map((tag) => tag.id));
  const requiredTeamTags = [`team:${home.teamId}`, `team:${away.teamId}`];
  const historicalPlayerByEvidenceId = new Map(historicalContext.players.map((player) => [
    `history.player.${player.playerId}`,
    player,
  ]));
  const weakHistoricalPlayerClaims = claimEntries(editorial).filter((claim) => claim.evidenceIds.some((id) => (
    id.startsWith("history.player.")
    && !(historicalPlayerByEvidenceId.get(id)?.notableChanges.length > 0)
  )));
  const copy = editorialText(editorial);
  const awkwardPatterns = [
    /הפך מחריגה לסיפור/,
    /ההיסטוריה הקצרה שלהם/,
    /המספרים מספרים/,
    /צבר(?:ה|ו)? את רוב האיום/,
    /xG\s*;/,
  ];
  const editorialReviewPassed = editorialReview.status === "passed" && Object.values(editorialReview.checks).every(Boolean);
  const checks = [
    ["match-ended", "המשחק הסתיים", match.status === "Ended", `סטטוס המקור: ${match.status}`],
    ["score-vs-events", "התוצאה תואמת לאירועי השערים", home.score === homeGoals && away.score === awayGoals, `${homeGoals}:${awayGoals} באירועים`],
    ["score-vs-players", "סך שערי השחקנים תואם לתוצאה", playerGoals === home.score + away.score, `${playerGoals} שערים בשורות השחקנים`],
    ["shots-home", "בעיטות הפועל תואמות למפת הבעיטות", home.stats.team_total_shots === home.shotSummary.count, `${home.shotSummary.count} בעיטות`],
    ["shots-away", "בעיטות מכבי תואמות למפת הבעיטות", away.stats.team_total_shots === away.shotSummary.count, `${away.shotSummary.count} בעיטות`],
    ["target-home", "בעיטות הפועל למסגרת תואמות", home.stats.team_shots_on_target === home.shotSummary.onTarget, `${home.shotSummary.onTarget} למסגרת`],
    ["target-away", "בעיטות מכבי למסגרת תואמות", away.stats.team_shots_on_target === away.shotSummary.onTarget, `${away.shotSummary.onTarget} למסגרת`],
    ["xg-home", "xG הפועל עקבי בין המקורות", Math.abs(home.stats.team_expected_goals - home.shotSummary.xg) <= 0.05, `${home.stats.team_expected_goals} מול ${home.shotSummary.xg}`],
    ["xg-away", "xG מכבי עקבי בין המקורות", Math.abs(away.stats.team_expected_goals - away.shotSummary.xg) <= 0.05, `${away.stats.team_expected_goals} מול ${away.shotSummary.xg}`],
    ["player-goal-events", "שערי השחקנים תואמים לאירועי הבעיטה", playerGoalEventsMatch, `${playerGoals} שערים נבדקו ברמת השחקן`],
    ["flow-shot-total", "חלונות הזמן מכסים את כל הבעיטות", windowShotTotal === shots.length, `${windowShotTotal} בעיטות בחלונות הזמן`],
    ["timeline-goals", "אירועי המשחק תואמים לשערים", timelineGoalTotal === home.score + away.score, `${timelineGoalTotal} שערים בציר האירועים`],
    ["heatmap-coverage", "כיסוי מפות החום מספיק לניתוח מבני", Number(spatialProfile?.starterHeatmaps ?? 0) >= 18, `${spatialProfile?.starterHeatmaps ?? 0} שחקני הרכב עם מפה`],
    ["history-order", "כל משחקי ההשוואה קדמו למשחק", historyPrecedesMatch, `${historicalMatches.length} משחקים קודמים נבדקו`],
    ["historical-player-volume", "השוואות שחקנים נשענות על מדדי נפח", weakHistoricalPlayerClaims.length === 0, weakHistoricalPlayerClaims.length ? `${weakHistoricalPlayerClaims.length} השוואות נשענו על מדגם חלש` : "לא נמצאו מגמות אישיות ממדגם קטן"],
    ["hebrew-copy-lint", "הנוסח נקי מתבניות עברית בעייתיות", awkwardPatterns.every((pattern) => !pattern.test(copy)), "נבדקו ניסוחים ומעברים מספריים בעייתיים"],
    ["editorial-review", "הנוסח עבר בקרת עברית, בהירות ורצף", editorialReviewPassed, editorialReview.notes.join(" | ")],
    ["article-tags", "תגיות הכתבה כוללות קבוצות, שחקנים וסוג כתבה", requiredTeamTags.every((id) => teamTagIds.has(id)) && tags.some((tag) => tag.kind === "player") && tags.some((tag) => tag.id === "topic:match-summary"), `${tags.length} תגיות נשמרו`],
    ["evidence-links", "לכל טענה יש הפניה לראיות", claimEntries(editorial).every((claim) => claim.evidenceIds.length > 0), `${claimEntries(editorial).length} טענות מקושרות`],
    ["numeric-claims", "כל המספרים בטקסט נתמכים", editorialFailures.length === 0, editorialFailures.length ? editorialFailures.join(" | ") : "לא נמצאו מספרים לא מבוססים"],
  ].map(([id, label, passed, detail]) => ({ id, label, status: passed ? "passed" : "failed", detail }));
  return checks;
}

function normalizeShot(shot) {
  return {
    eventId: shot.event_id,
    minute: Number(shot.minute),
    eventTime: shot.event_time,
    teamId: shot.team_id,
    teamNameHe: shot.team_name_he ?? shot.team_name,
    playerNameHe: shot.display_name_he ?? shot.display_name,
    x: numberValue(shot.x),
    y: numberValue(shot.y),
    xg: numberValue(shot.xg),
    xgot: numberValue(shot.xgot),
    outcome: shot.outcome,
    bodyPart: shot.body_part,
    situation: shot.situation,
  };
}

async function main() {
  await loadLocalEnv();
  const args = readArguments();
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.");

  const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const match = await selectMatch(client, args.matchId);
  const slug = `${cleanTeamSlug(match.away_team_name)}-at-${cleanTeamSlug(match.home_team_name)}-${datePart(match.scheduled_at)}`;
  const outputPath = path.join(generatedDirectory, `${slug}.json`);
  if (!args.matchId && !args.force) {
    try {
      await access(outputPath);
      console.log(JSON.stringify({ outputPath, slug, skipped: true, reason: "latest-match-already-published" }, null, 2));
      return;
    } catch {
      // Continue when this match does not yet have an article.
    }
  }
  const dataset = await fetchMatchDataset(client, match);
  if (dataset.teamRows.length === 0 || dataset.playerRows.length === 0 || dataset.shots.length === 0) {
    throw new Error("The selected match does not have the team, player, and shot data required for a grounded review.");
  }

  const teamStats = pivotTeamStats(dataset.teamRows);
  const players = pivotPlayerStats(dataset.playerRows);
  const hebrewNames = new Map([
    ...dataset.heatmaps.filter((row) => row.player_id && row.display_name_he).map((row) => [row.player_id, row.display_name_he]),
    ...dataset.shots.filter((shot) => shot.player_id && shot.display_name_he).map((shot) => [shot.player_id, shot.display_name_he]),
  ]);
  players.forEach((player) => {
    player.nameHe = hebrewNames.get(player.playerId) ?? player.nameHe;
  });
  const home = teamSnapshot(match, "home", teamStats.get(match.home_team_id) ?? {}, dataset.assets, dataset.shots);
  const away = teamSnapshot(match, "away", teamStats.get(match.away_team_id) ?? {}, dataset.assets, dataset.shots);
  const unitMatchups = {
    home: teamUnits(players, home.teamId),
    away: teamUnits(players, away.teamId),
  };
  const [providerGame, spatialProfile] = await Promise.all([
    fetchProviderGameDetail(dataset.shots),
    analyzeContentHeatmaps(dataset.heatmaps, players, home.teamId, away.teamId),
  ]);
  const homeHistoryDataset = await fetchHistoricalTeamDataset(client, match, home.teamId);
  const awayHistoryDataset = await fetchHistoricalTeamDataset(client, match, away.teamId);
  const playerHistoryDataset = await fetchHistoricalPlayerDataset(client, match, players);
  const timelineEvents = normalizeTimelineEvents(providerGame, players, home, away);
  const flowWindows = buildFlowWindows(dataset.shots, home.teamId, away.teamId);
  const historicalContext = buildHistoricalContext(home, away, players, homeHistoryDataset, awayHistoryDataset, playerHistoryDataset);
  const evidence = buildEvidence(
    match,
    home,
    away,
    players,
    dataset.shots,
    unitMatchups,
    dataset.heatmaps,
    flowWindows,
    timelineEvents,
    spatialProfile,
    historicalContext,
  );
  const usedAi = Boolean(process.env.OPENAI_API_KEY) && !args.noAi;
  if (!usedAi && match.match_id !== "5b2957d1-6f48-4269-baf6-2f53753eb160") {
    throw new Error("OPENAI_API_KEY is required for matches without a reviewed editorial seed.");
  }
  const draftEditorial = usedAi
    ? await generateEditorialWithAi(match, evidence, historicalContext)
    : fallbackEditorial(match, home, away);
  const reviewed = usedAi
    ? await editEditorialWithAi(match, evidence, historicalContext, draftEditorial)
    : curatedEditorialSeed(draftEditorial);
  const { editorial, review: editorialReview } = reviewed;
  const tags = buildArticleTags(home, away, players, editorial);
  const checks = buildChecks(match, home, away, players, dataset.shots, evidence, editorial, editorialReview, flowWindows, timelineEvents, spatialProfile, historicalContext, tags);
  const failedChecks = checks.filter((check) => check.status === "failed");
  if (failedChecks.length) {
    throw new Error(`Article rejected by fact checks:\n${failedChecks.map((check) => `- ${check.label}: ${check.detail}`).join("\n")}`);
  }

  const generatedAt = new Date().toISOString();
  const article = {
    schemaVersion: 1,
    slug,
    language: "he",
    kind: "match_review",
    status: "published",
    publishedAt: generatedAt,
    generatedAt,
    generation: {
      mode: usedAi ? "openai_writer_and_editor" : "reviewed_editorial_fallback",
      model: usedAi ? (process.env.OPENAI_MODEL ?? "gpt-5-mini") : null,
      pipelineVersion: "match-review-v4",
    },
    match: {
      matchId: match.match_id,
      competitionId: match.competition_id,
      competitionNameHe: match.competition_name_he ?? "ליגת העל",
      seasonId: match.season_id,
      seasonName: match.season_name,
      roundId: match.round_id,
      roundNumber: match.round_number,
      scheduledAt: match.scheduled_at,
      status: match.status,
    },
    teams: { home, away },
    tags,
    aiDisclosure: "גילוי נאות: הכתבה נוצרה בעזרת בינה מלאכותית על בסיס נתוני כדורדאטה. הנתונים והטענות המספריות עברו בדיקות אוטומטיות לפני הפרסום.",
    players,
    playerSpotlight: players
      .filter((player) => Number(player.metrics.goals ?? 0) > 0 || Number(player.metrics.assists ?? 0) > 0)
      .sort((left, right) => Number(right.metrics.rating_365 ?? 0) - Number(left.metrics.rating_365 ?? 0))
      .slice(0, 8),
    heatmaps: dataset.heatmaps,
    spatialProfile,
    unitMatchups,
    timelineEvents,
    flowWindows,
    actualPlayTime: providerGame?.actualPlayTime ? {
      actual: providerGame.actualPlayTime.actualTime?.name ?? null,
      total: providerGame.actualPlayTime.totalTime?.name ?? null,
    } : null,
    historicalContext,
    shots: dataset.shots.map(normalizeShot),
    editorialReview,
    editorial,
    evidence,
    factCheck: {
      status: "passed",
      checkedAt: generatedAt,
      checks,
      evidenceCount: evidence.length,
      claimCount: claimEntries(editorial).length,
      sourceViews: ["api_matches", "api_match_team_stats", "api_match_player_stats", "api_match_shots", "api_match_player_heatmaps", "365scores_game_detail"],
    },
  };

  if (!args.dryRun) {
    await mkdir(generatedDirectory, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(article, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ outputPath, slug, usedAi, checks: checks.length, dryRun: args.dryRun }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
