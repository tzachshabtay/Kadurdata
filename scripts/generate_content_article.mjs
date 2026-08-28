#!/usr/bin/env node

import { access, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { analyzeContentHeatmaps } from "./analyze_content_heatmaps.mjs";
import {
  buildGameStateContext,
  buildHistoricalAuditContext,
  buildInsightCandidates,
  buildMechanismContext,
  gameStateEvidenceValues,
  historicalAuditEvidenceValues,
  mechanismEvidenceValues,
} from "./content_analysis.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectory = path.join(projectRoot, "src", "content", "generated");
const HISTORICAL_WINDOW = 5;
const MAX_QUALITY_ATTEMPTS = 5;
const MAX_ANALYSIS_ATTEMPTS = 3;
const MAX_EDITORIAL_ATTEMPTS = 3;
const MAX_OPENAI_REQUEST_ATTEMPTS = 2;
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

async function postOpenAi(body, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_OPENAI_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(150_000),
      });
      if (response.ok) return response;
      const detail = await response.text();
      lastError = new Error(`${label} failed (${response.status}): ${detail}`);
      if (response.status < 500 && response.status !== 429) lastError.nonRetryable = true;
    } catch (error) {
      lastError = error;
    }
    if (lastError?.nonRetryable) throw lastError;
    if (attempt < MAX_OPENAI_REQUEST_ATTEMPTS) {
      console.log(JSON.stringify({ openAiRetry: label, attempt, reason: String(lastError) }, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
  throw lastError ?? new Error(`${label} failed without a response`);
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

function spatialTeamEvidenceValues(team) {
  return [
    team.sampleSize,
    team.defenderCount,
    team.midfielderCount,
    team.attackerCount,
    team.centralLanePlayers,
    team.halfSpacePlayers,
    team.wideLanePlayers,
    team.leftLanePlayers,
    team.rightLanePlayers,
    team.averageDepth,
    team.width,
    team.playersInAttackingHalf,
    team.playersInFinalThird,
    team.defenderDepth,
    team.midfielderDepth,
    team.attackerDepth,
    ...team.players.flatMap((player) => [player.x, player.y]),
  ];
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

function buildEvidence(match, home, away, players, shots, unitMatchups, heatmaps, flowWindows, timelineEvents, spatialProfile, historicalContext, historicalAuditContext, gameStateContext, mechanismContext) {
  const goals = shots.filter((shot) => shot.outcome === "Goal");
  const firstGoal = [...goals].sort((left, right) => Number(left.minute) - Number(right.minute))[0];
  const standoutPlayers = [...players]
    .filter((player) => Number(player.minutes ?? 0) >= 30 && player.roleGroup !== "Goalkeeper")
    .sort((left, right) => {
      const score = (player) => (
        Number(player.metrics.rating_365 ?? 0)
        + Number(player.metrics.expected_goals ?? 0) * 2
        + Number(player.metrics.expected_assists ?? 0) * 2
        + Number(player.metrics.key_passes ?? 0) * 0.5
        + Number(player.metrics.total_shots ?? 0) * 0.25
      );
      return score(right) - score(left);
    })
    .slice(0, 8);
  const bestChances = [...shots]
    .sort((left, right) => Number(right.xg ?? 0) - Number(left.xg ?? 0))
    .slice(0, 8);
  const homeMidfield = unitMatchups.home.midfielders;
  const awayMidfield = unitMatchups.away.midfielders;
  const homeAttack = unitMatchups.home.attackers;
  const awayAttack = unitMatchups.away.attackers;
  const awayDefense = unitMatchups.away.defenders;
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
    evidenceItem("match.result", "תוצאת המשחק", "api_matches", 1, [home.score, away.score], { home: { teamNameHe: home.nameHe, score: home.score }, away: { teamNameHe: away.nameHe, score: away.score } }),
    evidenceItem("match.opening_goal", "שער הפתיחה", "api_match_shots", firstGoal ? 1 : 0, firstGoal ? [firstGoal.minute, firstGoal.xg] : [], firstGoal ? {
      teamId: firstGoal.team_id,
      teamNameHe: firstGoal.team_name_he ?? firstGoal.team_name,
      playerId: firstGoal.player_id,
      playerNameHe: firstGoal.display_name_he ?? firstGoal.display_name,
      minute: Number(firstGoal.minute),
      expectedGoals: numberValue(firstGoal.xg),
    } : null),
    evidenceItem("team.volume", "נפח החזקה ובעיטות", "api_match_team_stats", 4, [
      home.stats.team_possession, away.stats.team_possession, home.stats.team_total_shots, away.stats.team_total_shots,
    ], { home: { teamNameHe: home.nameHe, possession: home.stats.team_possession, shots: home.stats.team_total_shots }, away: { teamNameHe: away.nameHe, possession: away.stats.team_possession, shots: away.stats.team_total_shots } }),
    evidenceItem("team.quality", "איכות המצבים", "api_match_team_stats", 8, [
      home.stats.team_expected_goals, away.stats.team_expected_goals,
      home.stats.team_shots_on_target, away.stats.team_shots_on_target,
      home.stats.team_big_chances_created, away.stats.team_big_chances_created,
      home.stats.team_expected_goals_on_target, away.stats.team_expected_goals_on_target,
    ], { home: { teamNameHe: home.nameHe, expectedGoals: home.stats.team_expected_goals, shotsOnTarget: home.stats.team_shots_on_target, bigChancesCreated: home.stats.team_big_chances_created, expectedGoalsOnTarget: home.stats.team_expected_goals_on_target }, away: { teamNameHe: away.nameHe, expectedGoals: away.stats.team_expected_goals, shotsOnTarget: away.stats.team_shots_on_target, bigChancesCreated: away.stats.team_big_chances_created, expectedGoalsOnTarget: away.stats.team_expected_goals_on_target } }),
    evidenceItem("team.progression", "התקדמות לעומת חדירה", "api_match_team_stats", 8, [
      home.stats.team_passes_into_final_third, away.stats.team_passes_into_final_third,
      home.stats.team_key_passes, away.stats.team_key_passes,
      home.stats.team_possession_lost, away.stats.team_possession_lost,
      home.stats.team_interceptions, away.stats.team_interceptions,
    ], {
      metricNoteHe: "מסירות לשליש האחרון אינן בהכרח מסירות קדימה",
      home: { teamNameHe: home.nameHe, passesIntoFinalThird: home.stats.team_passes_into_final_third, keyPasses: home.stats.team_key_passes, possessionLost: home.stats.team_possession_lost, interceptions: home.stats.team_interceptions },
      away: { teamNameHe: away.nameHe, passesIntoFinalThird: away.stats.team_passes_into_final_third, keyPasses: away.stats.team_key_passes, possessionLost: away.stats.team_possession_lost, interceptions: away.stats.team_interceptions },
    }),
    evidenceItem("style.team_profiles", "פרופיל סגנון המשחק", "api_match_team_stats", 14, [
      home.stats.team_passes_into_final_third, away.stats.team_passes_into_final_third,
      home.stats.team_key_passes, away.stats.team_key_passes,
      home.stats.team_crosses_completed, away.stats.team_crosses_completed,
      home.stats.team_expected_goals, away.stats.team_expected_goals,
      home.stats.team_possession_lost, away.stats.team_possession_lost,
      home.stats.team_interceptions, away.stats.team_interceptions,
      home.stats.team_backward_passes, away.stats.team_backward_passes,
    ], {
      home: { teamNameHe: home.nameHe, passesIntoFinalThird: home.stats.team_passes_into_final_third, keyPasses: home.stats.team_key_passes, crossesCompleted: home.stats.team_crosses_completed, expectedGoals: home.stats.team_expected_goals, possessionLost: home.stats.team_possession_lost, interceptions: home.stats.team_interceptions, backwardPasses: home.stats.team_backward_passes },
      away: { teamNameHe: away.nameHe, passesIntoFinalThird: away.stats.team_passes_into_final_third, keyPasses: away.stats.team_key_passes, crossesCompleted: away.stats.team_crosses_completed, expectedGoals: away.stats.team_expected_goals, possessionLost: away.stats.team_possession_lost, interceptions: away.stats.team_interceptions, backwardPasses: away.stats.team_backward_passes },
    }),
    evidenceItem("matchup.midfield", "המאבק בין חוליות הקישור", "api_match_player_stats", 12, [
      homeMidfield.recoveries, homeMidfield.tacklesWon, homeMidfield.tacklesAttempted,
      awayMidfield.recoveries, awayMidfield.tacklesWon, awayMidfield.tacklesAttempted,
      homeMidfield.goals, homeMidfield.expectedGoals, homeMidfield.shotsOnTarget,
      awayMidfield.goals, awayMidfield.expectedGoals, awayMidfield.shotsOnTarget,
    ], {
      scopeHe: "סיכום מדדי כל השחקנים שסווגו כקשרים בכל קבוצה; זו השוואת חוליות ולא דו־קרב אישי",
      home: { teamNameHe: home.nameHe, recoveries: homeMidfield.recoveries, tacklesWon: homeMidfield.tacklesWon, tacklesAttempted: homeMidfield.tacklesAttempted, goals: homeMidfield.goals, expectedGoals: homeMidfield.expectedGoals, shotsOnTarget: homeMidfield.shotsOnTarget },
      away: { teamNameHe: away.nameHe, recoveries: awayMidfield.recoveries, tacklesWon: awayMidfield.tacklesWon, tacklesAttempted: awayMidfield.tacklesAttempted, goals: awayMidfield.goals, expectedGoals: awayMidfield.expectedGoals, shotsOnTarget: awayMidfield.shotsOnTarget },
    }),
    evidenceItem("matchup.home_attack_away_defense", "התקפת המארחת מול הגנת האורחת", "api_match_player_stats", 10, [
      awayDefense.tacklesWon, awayDefense.tacklesAttempted, awayDefense.clearances, awayDefense.blocks,
      awayDefense.wasDribbledPast, homeAttack.shots, homeAttack.expectedGoals, homeAttack.goals,
      homeAttack.groundDuelsWon, homeAttack.groundDuelsAttempted,
    ], {
      homeAttack: { teamNameHe: home.nameHe, shots: homeAttack.shots, expectedGoals: homeAttack.expectedGoals, goals: homeAttack.goals, groundDuelsWon: homeAttack.groundDuelsWon, groundDuelsAttempted: homeAttack.groundDuelsAttempted },
      awayDefense: { teamNameHe: away.nameHe, tacklesWon: awayDefense.tacklesWon, tacklesAttempted: awayDefense.tacklesAttempted, clearances: awayDefense.clearances, blocks: awayDefense.blocks, wasDribbledPast: awayDefense.wasDribbledPast },
    }),
    evidenceItem("matchup.away_attack", "תרומת התקפת האורחת", "api_match_player_stats", 9, [
      awayAttack.goals, awayAttack.expectedGoals, awayAttack.keyPasses, awayAttack.expectedAssists,
      awayAttack.assists, awayMidfield.goals, awayMidfield.expectedGoals,
      awayDefense.goals, awayDefense.expectedGoals,
    ], {
      awayAttack: { teamNameHe: away.nameHe, goals: awayAttack.goals, expectedGoals: awayAttack.expectedGoals, keyPasses: awayAttack.keyPasses, expectedAssists: awayAttack.expectedAssists, assists: awayAttack.assists },
      awayMidfield: { teamNameHe: away.nameHe, goals: awayMidfield.goals, expectedGoals: awayMidfield.expectedGoals },
      awayDefense: { teamNameHe: away.nameHe, goals: awayDefense.goals, expectedGoals: awayDefense.expectedGoals },
    }),
    evidenceItem("flow.shot_windows", "זרימת איומי הבעיטה בחלונות זמן", "api_match_shots", shots.length, flowWindows.flatMap((window) => [
      window.start, window.end,
      window.home.shots, window.home.xg, window.home.goals,
      window.away.shots, window.away.xg, window.away.goals,
    ]), { windows: flowWindows, homeTeamNameHe: home.nameHe, awayTeamNameHe: away.nameHe }),
    evidenceItem("timeline.match_events", "אירועי משחק לפי דקה", "365scores_game_detail", timelineEvents.length, timelineEvents.map((event) => event.minute), { events: timelineEvents }),
    evidenceItem("flow.game_state_context", "המספרים המצטברים לפי מצב המשחק", "api_match_shots + 365scores_game_detail", shots.length + timelineEvents.length, gameStateEvidenceValues(gameStateContext), gameStateContext),
    evidenceItem("mechanism.chance_creation", "כיצד נוצר פער איכות המצבים", "api_match_shots + api_match_player_stats + api_match_player_heatmaps", shots.length + players.length + heatmaps.length, mechanismEvidenceValues(mechanismContext), {
      methodNoteHe: mechanismContext.methodHe,
      distortionCutoffMinute: mechanismContext.distortionCutoffMinute,
      centralPenaltyAreaRule: mechanismContext.centralPenaltyAreaRule,
      highQualityShotThreshold: mechanismContext.highQualityShotThreshold,
      betterQualitySide: mechanismContext.betterQualitySide,
      qualityPerShotGap: mechanismContext.qualityPerShotGap,
      teams: mechanismContext.teams,
    }),
    evidenceItem("mechanism.decisive_window", "מה התרחש בחלון הדומיננטי", "api_match_shots + api_match_player_stats + 365scores_game_detail", shots.length + timelineEvents.length, mechanismEvidenceValues(mechanismContext), {
      methodNoteHe: "האירועים המתוזמנים מאפשרים לתאר את סדר ההתרחשויות ואת השחקנים והחוליות שהיו מעורבים; סמיכות לחילוף אינה מוכיחה שהחילוף גרם לשינוי.",
      decisiveWindow: mechanismContext.decisiveWindow,
    }),
    evidenceItem("heatmap.spatial_profile", "מבנה מרחבי מצטבר של שחקני ההרכב", "api_match_player_heatmaps", heatmaps.length, spatialProfile ? [
      spatialProfile.starterHeatmaps,
      ...spatialTeamEvidenceValues(spatialProfile.home),
      ...spatialTeamEvidenceValues(spatialProfile.away),
    ] : [], spatialProfile ? {
      methodNoteHe: "הפרופיל מסכם את כל זמן ההופעה ואינו מחולק לדקות; אין להסיק ממנו שינוי במהלך המשחק",
      homeTeamNameHe: home.nameHe,
      awayTeamNameHe: away.nameHe,
      profile: spatialProfile,
    } : null),
    evidenceItem("player.match_standouts", "שחקנים בולטים במשחק", "api_match_player_stats", standoutPlayers.length, standoutPlayers.flatMap((player) => [
      player.minutes,
      player.metrics.rating_365,
      player.metrics.goals,
      player.metrics.assists,
      player.metrics.total_shots,
      player.metrics.shots_on_target,
      player.metrics.expected_goals,
      player.metrics.expected_assists,
      player.metrics.key_passes,
      player.metrics.touches,
      player.metrics.passes_attempted,
      player.metrics.passes_into_final_third,
      player.metrics.ball_recovery,
    ]), {
      players: standoutPlayers.map((player) => ({
        playerId: player.playerId,
        playerNameHe: player.nameHe,
        teamId: player.teamId,
        roleGroup: player.roleGroup,
        minutes: player.minutes,
        metrics: player.metrics,
      })),
    }),
    evidenceItem("match.best_chances", "המצבים האיכותיים במשחק", "api_match_shots", bestChances.length, bestChances.flatMap((shot) => [shot.minute, shot.xg, shot.xgot]), {
      shots: bestChances.map((shot) => ({
        minute: Number(shot.minute),
        teamId: shot.team_id,
        teamNameHe: shot.team_name_he ?? shot.team_name,
        playerId: shot.player_id,
        playerNameHe: shot.display_name_he ?? shot.display_name,
        expectedGoals: numberValue(shot.xg),
        expectedGoalsOnTarget: numberValue(shot.xgot),
        outcome: shot.outcome,
      })),
    }),
    evidenceItem("timeline.goals", "ציר שערי המשחק", "api_match_shots", goals.length, goals.flatMap((shot) => [
      shot.minute, shot.event_time?.includes("+") ? Number(shot.event_time.match(/\+\s*(\d+)/)?.[1] ?? 0) : null,
    ])),
    evidenceItem("match.shot_map", "מפת הבעיטות", "api_match_shots", shots.length, [
      shots.length, home.shotSummary.count, away.shotSummary.count, home.stats.team_expected_goals, away.stats.team_expected_goals,
    ], {
      metricNoteHe: "סיכום xG משתמש בנתון הקבוצתי הרשמי; מיקומי הבעיטות עצמם מגיעים מאירועי הבעיטה",
      home: { teamNameHe: home.nameHe, shots: home.shotSummary.count, expectedGoals: home.stats.team_expected_goals },
      away: { teamNameHe: away.nameHe, shots: away.shotSummary.count, expectedGoals: away.stats.team_expected_goals },
    }),
    evidenceItem("history.audit", "בדיקת שינויים לעומת משחקים קודמים", "api_matches + api_match_team_stats + api_match_player_stats", historicalAuditContext.teamMetricSeriesReviewed + historicalAuditContext.playerProfilesReviewed, historicalAuditEvidenceValues(historicalAuditContext), historicalAuditContext),
    ...historicalEvidence,
  ];
}

function fallbackEditorial(match, home, away) {
  return {
    headline: "פחות כדור, יותר איום: מכבי מצאה את דור פרץ בדיוק בזמן",
    headlineEvidenceIds: ["history.team.away", "player.match_standouts", "heatmap.spatial_profile"],
    dek: "מול הפועל ירושלים, מכבי תל אביב נראתה אחרת מ־5 משחקיה הקודמים: ההחזקה ירדה, הבעיטות זינקו, והמשחק דרך צד ימין סידר לדור פרץ את המצבים לשלושער. ה־5:2 לא נולד משליטה רציפה, אלא מ־2 פרקי זמן שבהם מכבי תקפה בחדות.",
    dekEvidenceIds: ["history.team.away", "match.result", "flow.shot_windows", "player.match_standouts", "heatmap.spatial_profile"],
    sections: [
      {
        heading: "השער הראשון הסתיר את הכיוון האמיתי",
        insightIds: ["decisive_match_window"],
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
        insightIds: ["team_history_change"],
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
        insightIds: ["spatial_structure"],
        paragraphs: [
          {
            text: "מפת החום מציבה את דור פרץ כשחקן השדה הקדמי ביותר של מכבי. הוא לא נשאר מאחור כדי לנהל את המשחק, אלא נכנס שוב ושוב לאזורים שמהם אפשר לסיים התקפה. המיקום הזה מסביר מדוע כל כך הרבה מהמצבים הטובים של מכבי הגיעו דווקא אליו.",
            evidenceIds: ["player.match_standouts", "heatmap.spatial_profile"],
          },
          {
            text: "פרץ בעט 4 פעמים, וכל הבעיטות שלו הלכו למסגרת. המצבים שמהם בעט היו שווים יחד 2.50 xG, והוא ניצל 3 מתוך 4 הבעיטות כדי לכבוש שלושער. זו הייתה גם יכולת סיום מצוינת וגם תוצאה של הגעה עקבית למצבים באיכות גבוהה.",
            evidenceIds: ["player.match_standouts", "heatmap.spatial_profile"],
          },
        ],
      },
      {
        heading: "רוב המצבים של הפועל הגיעו אחרי האדום",
        insightIds: ["game_state_distortion"],
        paragraphs: [
          {
            text: "במחצית הפועל הוציאה את זוברו שראני, שחקן הגנה, והכניסה את אוהד אלמגור, שחקן התקפה. החילוף סימן מעבר למבנה התקפי יותר, אבל בדקות 46–60 הפועל בעטה 3 פעמים בשווי 0.14 xG בלבד. הכמות עלתה לפני שהאיכות הגיעה.",
            evidenceIds: ["timeline.match_events", "flow.shot_windows", "heatmap.spatial_profile"],
          },
          {
            text: "רק אחרי הכרטיס האדום לאופק מליקה בדקה 77 נוצר לחץ רציף: בחלון 76–90 הפועל רשמה 9 בעיטות ו־0.68 xG, מול בעיטה אחת ו־0.14 xG של מכבי, וגם כבשה בדקה 90. לכן הנתון הסופי, 17–16 בבעיטות, מעט מטעה: חלק גדול מהבעיטות של הפועל הגיע כשהמשחק כבר הוכרע ומכבי הייתה בחיסרון מספרי.",
            evidenceIds: ["timeline.match_events", "flow.shot_windows", "flow.game_state_context", "team.volume"],
          },
        ],
      },
      {
        heading: "הצד הימני חיבר את כל החלקים",
        insightIds: ["spatial_structure", "player_volume_outlier"],
        paragraphs: [
          {
            text: "מפות החום משלימות את הסיפור: נועם בן הרוש נתן רוחב מעמדה נמוכה יותר, אושר דוידה נשאר גבוה ורחב, ודור פרץ מילא את חצי־המרחב ונכנס מעבר לשניהם. לא עומס כללי במרכז, אלא מסלול התקפה ברור בצד אחד.",
            evidenceIds: ["heatmap.spatial_profile"],
          },
          {
            text: "אצל דוידה השינוי בולט גם מול העבר הקרוב. הוא נגע בכדור 39 פעמים, לעומת 66.4 נגיעות ל־90 דקות ב־5 הופעות ההשוואה. ובכל זאת, הוא מסר 2 מסירות מפתח, בישל שער, והמסירות שלו יצרו 0.59 בישולים צפויים. פחות נגיעות, ובכל זאת תרומה ישירה ליצירת המצבים של מכבי.",
            evidenceIds: ["history.player.d331b8fc-d76c-4f8c-8a13-19e329c9b67a", "player.match_standouts", "history.team.away", "heatmap.spatial_profile"],
          },
        ],
      },
    ],
    takeaways: [
      { text: "מכבי עלתה מ־10.6 בעיטות בממוצע ל־17, אף שההחזקה ירדה ל־51%.", evidenceIds: ["history.team.away"] },
      { text: "דור פרץ בעט 4 פעמים, כולן למסגרת, והמצבים שלו הסתכמו ב־2.50 xG.", evidenceIds: ["player.match_standouts"] },
      { text: "9 מבעיטות הפועל הגיעו אחרי האדום בדקה 77.", evidenceIds: ["flow.game_state_context"] },
    ],
    conclusion: "מכבי לא ניצחה מפני ששיחקה יותר מאותו הדבר. היא ניצחה מפני ששיחקה אחרת: פחות החזקה, יותר חדירה, תיאום טוב בצד ימין ודור פרץ שקיבל שוב ושוב את הכדור במקום שממנו אפשר לכבוש.",
    conclusionEvidenceIds: ["history.team.away", "heatmap.spatial_profile", "player.match_standouts"],
  };
}

const FOOTBALL_HEBREW_GUIDE = [
  "השתמש בעברית של כדורגל ישראלי: מרכז השדה, אגפים או כנפיים, חילוצי כדור, מצבים, בעיטות ולחץ.",
  "אל תשתמש במילה 'נתיב' או 'נתיבים' לתיאור אזורים במגרש.",
  "חצי־מרחב הוא האזור שבין מרכז השדה לאגף. בכתיבה לקהל רחב, כתוב בפעם הראשונה 'חצי־המרחב שבין המרכז לאגף'.",
  "אל תכתוב שקבוצה 'ייצרה בעיטות', 'צברה איום' או 'קיבלה איומים'. כתוב שהיא בעטה, הגיעה למצבים או אפשרה ליריבה להגיע למצבים.",
].join("\n");

const analysisPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    thesis: {
      type: "object",
      additionalProperties: false,
      properties: {
        claimHe: { type: "string" },
        whyItMattersHe: { type: "string" },
        evidenceIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      },
      required: ["claimHe", "whyItMattersHe", "evidenceIds"],
    },
    rankedInsights: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          titleHe: { type: "string" },
          findingHe: { type: "string" },
          whyItMattersHe: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
          importance: { type: "string", enum: ["primary", "supporting", "context"] },
          narrativeRole: { type: "string", enum: ["setup", "turning_point", "explanation", "context", "caveat"] },
        },
        required: ["id", "titleHe", "findingHe", "whyItMattersHe", "evidenceIds", "importance", "narrativeRole"],
      },
    },
    explanatoryModel: {
      type: "object",
      additionalProperties: false,
      properties: {
        questionHe: { type: "string" },
        answerHe: { type: "string" },
        supportLevel: { type: "string", enum: ["triangulated", "descriptive"] },
        evidenceIds: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 8 },
        components: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              findingHe: { type: "string" },
              whyItExplainsHe: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              limitationHe: { type: "string" },
              evidenceIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
            },
            required: ["findingHe", "whyItExplainsHe", "confidence", "limitationHe", "evidenceIds"],
          },
        },
      },
      required: ["questionHe", "answerHe", "supportLevel", "evidenceIds", "components"],
    },
    historicalAudit: {
      type: "object",
      additionalProperties: false,
      properties: {
        decision: { type: "string", enum: ["use", "omit"] },
        teamSignalsReviewed: { type: "boolean" },
        playerSignalsReviewed: { type: "boolean" },
        findingHe: { type: "string" },
        evidenceIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      },
      required: ["decision", "teamSignalsReviewed", "playerSignalsReviewed", "findingHe", "evidenceIds"],
    },
    narrativeArc: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          headingIdeaHe: { type: "string" },
          purposeHe: { type: "string" },
          insightIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 },
        },
        required: ["headingIdeaHe", "purposeHe", "insightIds"],
      },
    },
    graphics: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["match_flow", "shot_map", "team_history", "tactical_heatmap", "player_focus"] },
          titleHe: { type: "string" },
          subtitleHe: { type: "string" },
          placementInsightId: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
          metricCodes: { type: "array", items: { type: "string" }, maxItems: 4 },
          focusPlayerId: { type: "string" },
        },
        required: ["type", "titleHe", "subtitleHe", "placementInsightId", "evidenceIds", "metricCodes", "focusPlayerId"],
      },
    },
    coverageDecisions: {
      type: "array",
      minItems: 8,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: ["game_state", "flow", "quality", "style", "matchup", "spatial", "history", "player"] },
          decision: { type: "string", enum: ["use", "omit"] },
          reasonHe: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" }, maxItems: 5 },
        },
        required: ["category", "decision", "reasonHe", "evidenceIds"],
      },
    },
    quality: {
      type: "object",
      additionalProperties: false,
      properties: {
        singleThesis: { type: "boolean" },
        explainsRatherThanLists: { type: "boolean" },
        gameStateAdjusted: { type: "boolean" },
        selectiveEvidence: { type: "boolean" },
        graphicsServeStory: { type: "boolean" },
        explanatoryDepth: { type: "boolean" },
        historicalAuditComplete: { type: "boolean" },
      },
      required: ["singleThesis", "explainsRatherThanLists", "gameStateAdjusted", "selectiveEvidence", "graphicsServeStory", "explanatoryDepth", "historicalAuditComplete"],
    },
  },
  required: ["thesis", "rankedInsights", "explanatoryModel", "historicalAudit", "narrativeArc", "graphics", "coverageDecisions", "quality"],
};

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
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          insightIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 },
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
        required: ["heading", "insightIds", "paragraphs"],
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
    graphics: analysisPlanSchema.properties.graphics,
    checks: {
      type: "object",
      additionalProperties: false,
      properties: {
        naturalHebrew: { type: "boolean" },
        footballHebrew: { type: "boolean" },
        numericClarity: { type: "boolean" },
        cohesiveNarrative: { type: "boolean" },
        storyValue: { type: "boolean" },
        numberDiscipline: { type: "boolean" },
        highVolumeComparisonsOnly: { type: "boolean" },
        evidenceFaithfulness: { type: "boolean" },
        gameStateContext: { type: "boolean" },
        graphicRelevance: { type: "boolean" },
        explanatoryDepth: { type: "boolean" },
        historicalAuditComplete: { type: "boolean" },
      },
      required: ["naturalHebrew", "footballHebrew", "numericClarity", "cohesiveNarrative", "storyValue", "numberDiscipline", "highVolumeComparisonsOnly", "evidenceFaithfulness", "gameStateContext", "graphicRelevance", "explanatoryDepth", "historicalAuditComplete"],
    },
    notes: { type: "array", items: { type: "string" }, maxItems: 6 },
  },
  required: ["editorial", "graphics", "checks", "notes"],
};

const qualityReviewResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    checks: {
      type: "object",
      additionalProperties: false,
      properties: {
        naturalHebrew: { type: "boolean" },
        footballHebrew: { type: "boolean" },
        numericClarity: { type: "boolean" },
        cohesiveNarrative: { type: "boolean" },
        storyValue: { type: "boolean" },
        numberDiscipline: { type: "boolean" },
        highVolumeComparisonsOnly: { type: "boolean" },
        evidenceFaithfulness: { type: "boolean" },
        gameStateContext: { type: "boolean" },
        graphicRelevance: { type: "boolean" },
        explanatoryDepth: { type: "boolean" },
        historicalAuditComplete: { type: "boolean" },
      },
      required: ["naturalHebrew", "footballHebrew", "numericClarity", "cohesiveNarrative", "storyValue", "numberDiscipline", "highVolumeComparisonsOnly", "evidenceFaithfulness", "gameStateContext", "graphicRelevance", "explanatoryDepth", "historicalAuditComplete"],
    },
    issues: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
  required: ["checks", "issues"],
};

function responseOutputText(payload) {
  return payload.output_text ?? payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;
}

function evidenceSelectedByPlan(evidence, analysisPlan) {
  const selectedIds = new Set([
    ...analysisPlan.thesis.evidenceIds,
    ...analysisPlan.rankedInsights.flatMap((insight) => insight.evidenceIds),
    ...analysisPlan.explanatoryModel.evidenceIds,
    ...analysisPlan.explanatoryModel.components.flatMap((component) => component.evidenceIds),
    ...analysisPlan.historicalAudit.evidenceIds,
    ...analysisPlan.graphics.flatMap((graphic) => graphic.evidenceIds),
    ...analysisPlan.coverageDecisions.filter((decision) => decision.decision === "use").flatMap((decision) => decision.evidenceIds),
  ]);
  return evidence.filter((item) => selectedIds.has(item.id));
}

async function generateAnalysisPlanWithAi(match, evidence, insightCandidates, gameStateContext, analysisFeedback = []) {
  const model = process.env.OPENAI_ANALYST_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.6";
  const response = await postOpenAi({
      model,
      store: false,
      instructions: [
        "אתה האנליסט הראשי של מדור כדורגל מבוסס נתונים. לפני שנכתבת כתבה, עליך לבחור מהו הסיפור האמיתי של המשחק ומה לא ראוי להיכנס אליה.",
        "בחר תזה מרכזית אחת ועד 5 תובנות שמסבירות אותה. דירוג אלגוריתמי של מועמדים הוא נקודת פתיחה בלבד; בדוק את ההקשר והראיות בעצמך.",
        "אל תסתפק בתיאור מי בעטה יותר או באילו דקות נוצר פער. בנה explanatoryModel שעונה על שאלת ה'למה' באמצעות הצלבה של לפחות 2 משפחות נתונים: מיקום ואיכות בעיטות, זהות או חוליית המסיימים, תרומת חוליות ליצירה, המבנה המרחבי ואירועים מתוזמנים.",
        "ב-explanatoryModel הפרד בין ממצא, הסבר ומגבלה. נתונים תצפיתיים יכולים לתמוך במנגנון סביר אך אינם מוכיחים סיבתיות; supportLevel יהיה triangulated רק כש-2 מקורות בלתי תלויים מצביעים לאותו כיוון, ואחרת descriptive.",
        "כאשר chance_creation_mechanism קיבל ציון 75 ומעלה, בחר אותו כתובנת primary או supporting והסבר מה במבנה המצבים או בחלוקת התפקידים תרם לפער האיכות. כאשר decisive_window_mechanism קיבל ציון 75 ומעלה, בחר גם אותו והסבר מי ובאיזה תפקיד היה מעורב בחלון, ומה השתנה בסדר האירועים — בלי לייחס לחילוף סיבה שלא הוכחה.",
        "אל תבחר גם את תובנת המנגנון וגם את הגרסה התיאורית שהיא מחליפה: chance_creation_mechanism מחליפה את chance_quality_gap, ו-decisive_window_mechanism מחליפה את decisive_match_window. כך נשאר מקום להקשר היסטורי, מבני או אישי שבאמת מוסיף הסבר.",
        "בדוק תמיד אם התוצאה, כרטיס אדום, חילופים או דקות מאוחרות מעוותים נתונים מצטברים. כאשר rawShotTotalsNeedGameStateContext=true, game_state_distortion חייבת להיות תובנה primary, להופיע בתחילת הקשת הסיפורית ולהיתמך ב-flow.game_state_context.",
        "אל תתייחס ל-16 בעיטות בדקות שוויון כמו ל-16 בעיטות אחרי שהמשחק הוכרע. נפח מאוחר עשוי ללמד על זרימת המשחק, אבל לא בהכרח על מאזן הכוחות לפני האירוע.",
        "היסטוריה, מפות חום, מאבקים בין חוליות ושחקנים הם חומרי גלם לבחירה, לא סעיפי חובה. עם זאת, historicalAudit הוא חובה: בדוק את history.audit, את אותות הקבוצות ואת חריגות הנפח האישיות. סמן use רק אם נמצא שינוי משמעותי שמוסיף הסבר לתזה; אחרת סמן omit וכתוב מה היה האות החזק ביותר שנבדק ומדוע אינו מספיק.",
        "העדף דפוסי נפח ממדגם סביר על פני שער או בישול בודד. אל תסיק סיבתיות מנתון תצפיתי, ואל תמציא שינוי בזמן ממפת חום מצטברת.",
        "תכנן 2–4 גרפיקות בלבד. כל גרפיקה חייבת לתמוך בתובנה שנבחרה ולהציג משהו שקל יותר להבין חזותית מאשר בטקסט. אל תבחר גרפיקה כדי למלא מקום.",
        "כותרת וכותרת המשנה של גרפיקה חייבות להסביר מה היא מראה בלי לכלול מספרים. הערכים עצמם יוצגו מתוך הנתונים בקומפוננטה, וכך לא ייווצרו פערי מקור או עיגול בין הטקסט לגרפיקה.",
        "לגרפיקת team_history בחר metricCodes מתוך מדדי ההיסטוריה שבחבילת הראיות. לגרפיקת player_focus בחר focusPlayerId קיים. בסוגים אחרים החזר מערכים או מזהים ריקים כאשר אינם נדרשים.",
        "coverageDecisions חייב להכיל פעם אחת בדיוק כל אחת מ-8 הקטגוריות. סמן use רק לקטגוריות שמהן בחרת rankedInsight, ו-omit לכל היתר. rankedInsights ו-narrativeArc חייבים להשתמש רק במזהי המועמדים שסופקו.",
        "בחר בדיוק תובנת primary אחת. בחר סוג גרפיקה שונה לכל גרפיקה, כדי שכל המחשה תוסיף זווית אחרת ולא תחזור על אותה תבנית.",
        analysisFeedback.length ? "תוכנית קודמת נכשלה באימות. תקן כל סעיף ב-analysisFeedback ואל תחזיר את אותה תוכנית." : "זוהי תוכנית הניתוח הראשונה.",
        FOOTBALL_HEBREW_GUIDE,
      ].join("\n"),
      input: JSON.stringify({
        match: {
          competition: match.competition_name_he ?? match.competition_name,
          scheduledAt: match.scheduled_at,
          home: match.home_team_name_he ?? match.home_team_name,
          away: match.away_team_name_he ?? match.away_team_name,
        },
        gameStateContext,
        insightCandidates,
        evidence,
        analysisFeedback,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "hebrew_match_analysis_plan",
          strict: true,
          schema: analysisPlanSchema,
        },
      },
    }, "OpenAI analyst");
  const payload = await response.json();
  const outputText = responseOutputText(payload);
  if (!outputText) throw new Error("The analyst returned no structured plan.");
  return { plan: JSON.parse(outputText), model };
}

async function generateEditorialWithAi(match, evidence, analysisPlan, gameStateContext) {
  const selectedEvidence = evidenceSelectedByPlan(evidence, analysisPlan);
  const response = await postOpenAi({
      model: process.env.OPENAI_MODEL ?? "gpt-5.6",
      store: false,
      instructions: [
        "אתה כתב כדורגל ישראלי. כתוב כתבת ניתוח מקורית, בהירה ומדויקת בעברית בלבד לפי analysisPlan שסיפק האנליסט.",
        "השתמש אך ורק בחבילת הראיות שסופקה. אין להוסיף הקשר חיצוני, ציטוטים, סיבות טקטיות שלא נמדדו או עובדות שאינן בחבילה.",
        "לכל טענה מספרית צרף רק מזהי evidenceIds שמכילים את המספרים הללו. שמור על טון עיתונאי ולא שיווקי.",
        "כל מספר שמופיע בטקסט חייב להופיע כפי שהוא במערך values של אחת הראיות המצורפות. אל תחשב הפרשים, ממוצעים, אחוזים או יחסים חדשים בעצמך.",
        "אל תכתוב 'מצב איכותי' או 'בעיטה באיכות גבוהה' על בסיס shotsAtLeastPointTwoXg בלי לציין שהכוונה לבעיטה בשווי 0.20 xG לפחות. עדיף בדרך כלל לתאר את מיקום הבעיטות ואת ה-xG הממוצע לבעיטה.",
        "כתוב כל כמות ומספר בספרות (למשל 6, לא שישה), כדי שמנוע האימות יוכל לבדוק אותם.",
        "המונחים המקצועיים היחידים שמותר לכתוב באותיות לטיניות הם xG ו-xGOT. אם משתמשים ב-xGOT, כתוב בפעם הראשונה 'שערים צפויים מבעיטות למסגרת (xGOT)' ואל תשתמש בניסוח המעורפל 'שערים צפויים לאחר הבעיטה'.",
        "הכותרת והפתיח צריכים להציג את התזה, וכל סעיף צריך לקדם את הקשת הסיפורית שנבחרה. השתמש רק בתובנות שסומנו use וב-rankedInsights; אל תכניס בכוח קטגוריה שסומנה omit.",
        "analysisPlan.explanatoryModel הוא עמוד השדרה של הכתבה. אל תכתוב רק מה קרה; הסבר כיצד נוצר פער איכות המצבים וכיצד נבנה החלון הדומיננטי, באמצעות המרכיבים שהאנליסט חיבר. הצג את ההסבר כקריאה מבוססת נתונים ולא כהוכחת סיבתיות.",
        "בכל תובנת מנגנון שנבחרה, לפחות פסקה אחת חייבת להסתמך על evidenceId שמתחיל ב-mechanism. חבר בין המקום שממנו בעטו, חוליית המסיימים, חוליות היצירה והאירועים המתוזמנים; אל תציג כל אחד מהם כרשימת נתונים נפרדת.",
        "כל סעיף חייב לקבל insightIds מתוך analysisPlan. סדר הסעיפים חייב לעקוב אחר narrativeArc, ותובנת primary חייבת להופיע באחד מ-2 הסעיפים הראשונים.",
        "כל פסקה צריכה לעבוד כך: טענה אחת, הסבר למה היא חשובה, ורק אז 1–3 מספרים חיוניים כתמיכה. אל תכתוב רשימת מדדים ואל תנסה להכניס את כל הנתונים הזמינים.",
        "נקודות הסיכום רשאיות רק לתמצת טענות שכבר הוסברו בגוף הכתבה. אל תציג בהן מספר או עובדה שלא הופיעו קודם בגוף.",
        "כתוב עברית עיתונאית טבעית עם קצב מגוון. הימנע מניסוחים תבניתיים כמו 'המספרים מספרים', מחזרות על 'כלומר', ומפסקאות שנשמעות כמו טבלת נתונים.",
        "השתמש בהשוואה היסטורית רק אם analysisPlan.historicalAudit.decision הוא use וקטגוריית history נבחרה. ציין את גודל המדגם והצג אותה כהקשר, לא כהוכחה מוחלטת לשינוי טקטי. אם ההחלטה היא omit, אל תכתוב לקורא שלא נמצא שינוי ואל תוסיף סעיף מתודולוגי; פשוט השאר את ההיסטוריה מחוץ לכתבה.",
        "אם נבחרה השוואת שחקן היסטורית, היא מותרת רק מתוך notableChanges: מדדי נפח עם לפחות 3 משחקי בסיס. אין להציג שערים, בישולים, כרטיסים או אירוע בודד כמגמה.",
        "הזכר בשם לפחות שחקן אחד שיש לו ראיות משמעותיות, כדי שהכתבה תוכל לקבל תגית שחקן שימושית.",
        "אל תבנה סעיף שלם סביב בעיטה אחת או אירוע אישי יחיד. דוגמת שחקן חייבת להסביר, להמחיש או לסייג את התזה המרכזית של הכתבה.",
        "כאשר gameStateContext.rawShotTotalsNeedGameStateContext=true, אל תציג את סך הבעיטות כהשוואה מאוזנת בלי להסביר מוקדם בכתבה כמה מהן הגיעו אחרי האירוע המעוות ובאיזה מצב תוצאה.",
        "השתמש בפרופיל המרחבי ממפות החום כדי לזהות מבנה, רוחב, חצי־מרחבים ועומס מקומי. אל תכתוב לקורא הערה מתודולוגית על זמן, צבירה או מגבלות מפות החום, ואל תצטט קואורדינטות טכניות; פשוט הימנע מטענות על שינוי במהלך המשחק שאינן נתמכות.",
        "תאר שינוי טקטי רק כשהוא נתמך גם בחילוף בין תפקידים או באירוע מתוזמן; מפות החום לבדן מתארות את זמן ההופעה המצטבר.",
        FOOTBALL_HEBREW_GUIDE,
      ].join("\n"),
      input: JSON.stringify({
        match: {
          competition: match.competition_name_he ?? match.competition_name,
          scheduledAt: match.scheduled_at,
          home: match.home_team_name_he ?? match.home_team_name,
          away: match.away_team_name_he ?? match.away_team_name,
        },
        analysisPlan,
        gameStateContext,
        evidence: selectedEvidence,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "hebrew_match_review",
          strict: true,
          schema: editorialSchema,
        },
      },
    }, "OpenAI writer");
  const payload = await response.json();
  const outputText = responseOutputText(payload);
  if (!outputText) throw new Error("The model returned no structured editorial output.");
  return JSON.parse(outputText);
}

async function editEditorialWithAi(match, evidence, analysisPlan, gameStateContext, draft, qualityFeedback = []) {
  const model = process.env.OPENAI_EDITOR_MODEL ?? "gpt-5.6";
  const selectedEvidence = evidenceSelectedByPlan(evidence, analysisPlan);
  const response = await postOpenAi({
      model,
      store: false,
      instructions: [
        "אתה העורך הראשי של מדור כדורגל ישראלי. קיבלת טיוטה שכבר נכתבה; תפקידך לערוך אותה, לא רק לאשר אותה.",
        "כתוב עברית ישראלית טבעית שאפשר לשמוע ולקרוא במדור ספורט מקצועי. תקן תרגומי־מכונה, צירופים שאינם מקובלים, כותרות עמומות, מטפורות מאולצות וכינויי גוף שאין להם מושא ברור.",
        "אל תשתמש בצירופים מופשטים כמו 'לצבור איום'. כתוב במונחי כדורגל טבעיים ומוחשיים: להגיע למצבים, לבעוט, להחזיק בכדור, ללחוץ או לייצר הזדמנויות.",
        "אל תכתוב 'להציב יותר נוכחות' או שקבוצה 'קיבלה יותר איומים'. כתוב מי הציב יותר שחקנים באזור, או איזו חוליה תרמה יותר בעיטות, מצבים או שערים.",
        "ודא שכל רצף מספרי מובן מיד: כתוב מה נמדד, מהו הסכום, ומה קרה בפועל. אל תצמיד מספר ל-xG ולמספר שערים באותו חצי משפט אם הקשר ביניהם אינו מפורש.",
        "שמור על התזה, התובנות והקשת הסיפורית שב-analysisPlan. הסר משפטים שנשמעים כמו סיכום אוטומטי, רשימת מדדים או ניתוח צדדי שלא נבחר בתוכנית.",
        "בדוק שהכתבה מיישמת את analysisPlan.explanatoryModel ולא רק חוזרת על התוצאה והפערים. חייב להיות בה חיבור מפורש בין לפחות 2 סוגי ראיות שמסביר כיצד נוצרו המצבים האיכותיים או כיצד התפתח החלון הדומיננטי.",
        "כאשר הראיות מצביעות על חלוקת עבודה בין חוליות, נסח אותה בכדורגל טבעי: מי יצר, מי הצטרף לרחבה או למרכז, ומי סיים. אל תהפוך מתאם להוראה טקטית או לסיבה מוכחת.",
        "אסור להשמיט תובנת מנגנון שנבחרה ב-analysisPlan. ודא של-chance_creation_mechanism ול-decisive_window_mechanism, כאשר נבחרו, יש סעיף בגוף ולפחות פסקה אחת עם ראיית mechanism המתאימה. אם טיוטה קודמת השמיטה סעיף, הוסף אותו כעת; אינך רשאי לשנות את תוכנית הגרפיקה במקום לתקן את הכתבה.",
        "החזר גם graphics מעודכן. מותר לערוך כותרת, כותרת משנה, placementInsightId ו-evidenceIds כדי לתקן חוסר התאמה, אך אסור להוסיף תובנה שלא נבחרה. שמור על 2–4 סוגי גרפיקה שונים ועל גרפיקה רק כאשר היא משרתת סעיף שקיים בגוף.",
        "טווחי הגרפיקות קבועים לפי הקומפוננטה: match_flow מציגה את כל חלונות המשחק; shot_map מציגה את כל בעיטות המשחק; team_history מציגה את חלון המשחקים הקודמים; tactical_heatmap מציגה את זמן ההופעה כולו; player_focus מציגה את נתוני המשחק המלא. אל תבטיח בכותרת סינון זמן שאינו קיים, ואל תכלול מספרים בכותרת או בכותרת המשנה.",
        "בכל פסקה שמור על טענה אחת, הסבר של המשמעות, ורק המספרים החיוניים. אם יש 4 מספרים או יותר, פצל או הסר את אלה שאינם נדרשים להבנת הטענה.",
        "ודא שנקודות הסיכום אינן מכניסות מספר או עובדה חדשים שלא הופיעו בגוף הכתבה.",
        "בדוק התאמה דקדוקית כאשר נושא המשפט הוא טווח או צמד מספרים. אם ההתאמה אינה טבעית, כתוב 'מאזן של...' במקום לפתוח את המשפט במספרים.",
        "ביחס בין 2 קבוצות, כתוב ראשון את המספר של הקבוצה שהיא נושא המשפט. אם מכבי הובילה בבעיטות, הניסוח צריך להיות 'מכבי הובילה 17:7' ולא '7:17'.",
        "מותר לתאר שער או בישול כאירוע במשחק הנוכחי, אך אסור להציג שערים, בישולים, כרטיסים או מדגם קטן כמגמה היסטורית.",
        "השוואה היסטורית נדרשת רק אם analysisPlan בחר בה. השוואה היסטורית אישית מותרת רק כאשר היא נשענת על notableChanges עם לפחות 3 משחקים, נפח מספיק וחריגה משמעותית.",
        "ודא ש-analysisPlan.historicalAudit תואם לשימוש בפועל: אם decision=omit, הסר השוואות היסטוריות מהנוסח; אם decision=use, הצג רק את האותות שנבחרו ובצירוף גודל המדגם והסייג.",
        "אל תוסיף עובדות, מספרים או פרשנות שאינם בראיות. שמור או תקן את evidenceIds כך שכל טענה תישען רק על הראיות המתאימות.",
        "כל מספר חייב להופיע כפי שהוא ב-values של הראיות המצורפות לטענה. אל תחשב בעצמך הפרש, ממוצע, אחוז או יחס חדש, גם אם החישוב פשוט.",
        "שמור בנוסח לפחות אזכור אחד בשם של שחקן בעל ראיה משמעותית. אסור להסיר את כל שמות השחקנים, מפני שהפרסום דורש לפחות תגית שחקן אחת.",
        "אם מופיע xGOT, כתוב בפעם הראשונה 'שערים צפויים מבעיטות למסגרת (xGOT)'. אל תכתוב 'שערים צפויים לאחר הבעיטה' ואל תבנה סעיף נפרד סביב בעיטה יחידה שאינה מקדמת את התזה.",
        "מפת חום או matchup יישארו רק אם analysisPlan בחר בהם. כאשר הם נבחרו, הטענות צריכות לפרש מבנה או מאבק בין חוליות ולא להסביר את שיטת המדידה.",
        "קרא כל משפט בקול לפני ההחזרה. פסול ותקן שגיאות התאמה, מילים מומצאות, צירופים מתורגמים, פעלים שאינם מתאימים לנתון ומטפורות עמומות.",
        "נתוני משחק תצפיתיים מראים קשר ולא סיבתיות. בלי ראיה סיבתית מפורשת, אל תכתוב 'בזכות', 'הכריע', 'הוביל ל-', 'גרם' או 'הסביר את התוצאה'; כתוב מה היה הפער הבולט בנתונים.",
        "נתון מצטבר אחרי אירוע אינו מוכיח לבדו שקצב הפעולה עלה. כאשר context כולל השוואת לפני־ואחרי מפורשת, מותר לתאר את ההבדל בקצב; עדיין אסור לטעון שהאירוע גרם לו בלי ראיה סיבתית.",
        "כאשר gameStateContext.rawShotTotalsNeedGameStateContext=true, ודא שהסיפור המרכזי ואחד מ-2 הסעיפים הראשונים מסבירים מדוע נתוני הבעיטות הכוללים מטעים. תיקון במסקנה בלבד אינו מספיק.",
        FOOTBALL_HEBREW_GUIDE,
        "כאשר qualityFeedback כולל ניסוח שנפסל ותיקון מוצע, ודא שהנוסח הפסול אינו נשאר בגרסה החדשה ושמשמעות התיקון יושמה במלואה. אל תחליף אותו במשפט שסותר את הראיה.",
        "החזר נוסח מתוקן גם אם הטיוטה סבירה. סמן את כל הבדיקות true רק לאחר שתיקנת בפועל כל בעיה שמצאת.",
        qualityFeedback.length
          ? "מבקר האיכות פסל גרסה קודמת. תקן במפורש כל סעיף ב-qualityFeedback ואל תסתפק בהחלפת מילה מקומית אם המשפט כולו אינו טבעי."
          : "זוהי עריכת הנוסח הראשונה; בצע עריכה מלאה ולא הגהה שטחית.",
      ].join("\n"),
      input: JSON.stringify({
        match: {
          competition: match.competition_name_he ?? match.competition_name,
          scheduledAt: match.scheduled_at,
          home: match.home_team_name_he ?? match.home_team_name,
          away: match.away_team_name_he ?? match.away_team_name,
        },
        analysisPlan,
        gameStateContext,
        evidence: selectedEvidence,
        draft,
        qualityFeedback,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "hebrew_editorial_review",
          strict: true,
          schema: editorialReviewResponseSchema,
        },
      },
    }, "OpenAI football editor");
  const payload = await response.json();
  const outputText = responseOutputText(payload);
  if (!outputText) throw new Error("The editorial review returned no structured output.");
  const reviewed = JSON.parse(outputText);
  const passed = Object.values(reviewed.checks).every(Boolean);
  return {
    editorial: reviewed.editorial,
    graphics: reviewed.graphics,
    review: {
      mode: "openai_second_pass_editor",
      model,
      status: passed ? "passed" : "failed",
      checks: reviewed.checks,
      notes: reviewed.notes,
    },
  };
}

function editorialStructureFailures(editorial, analysisPlan) {
  const failures = [];
  const sectionInsightIds = new Set(editorial.sections.flatMap((section) => section.insightIds ?? []));
  const claimEvidenceIds = new Set(claimEntries(editorial).flatMap((claim) => claim.evidenceIds ?? []));
  for (const insight of analysisPlan.rankedInsights) {
    if (!sectionInsightIds.has(insight.id)) failures.push(`התובנה שנבחרה ${insight.id} חסרה מסעיפי הכתבה`);
  }
  for (const [insightId, evidenceId] of [
    ["chance_creation_mechanism", "mechanism.chance_creation"],
    ["decisive_window_mechanism", "mechanism.decisive_window"],
  ]) {
    if (analysisPlan.rankedInsights.some((insight) => insight.id === insightId)
      && !editorial.sections.some((section) => section.insightIds?.includes(insightId)
        && section.paragraphs.some((paragraph) => paragraph.evidenceIds.includes(evidenceId)))) {
      failures.push(`התובנה ${insightId} אינה מוסברת באמצעות ${evidenceId}`);
    }
  }
  const usesHistoricalEvidence = [...claimEvidenceIds].some((id) => id.startsWith("history.team.") || id.startsWith("history.player."));
  if (analysisPlan.historicalAudit.decision === "use" && !usesHistoricalEvidence) failures.push("הביקורת ההיסטורית בחרה use אך אין בגוף השוואה היסטורית");
  if (analysisPlan.historicalAudit.decision === "omit" && usesHistoricalEvidence) failures.push("הביקורת ההיסטורית בחרה omit אך הכתבה משתמשת בהשוואה היסטורית");
  for (const graphic of analysisPlan.graphics) {
    if (!sectionInsightIds.has(graphic.placementInsightId)) failures.push(`הגרפיקה ${graphic.type} משויכת לתובנה שאינה מופיעה בגוף`);
    if (extractNumbers(`${graphic.titleHe} ${graphic.subtitleHe}`).length) failures.push(`כותרת הגרפיקה ${graphic.type} כוללת מספרים`);
  }
  const copy = editorialText(editorial);
  if (/מפת?\s*ה?(?:חום|מיקום|פעילות).*?(?:מצטברת|אינה תלויה בזמן|אינה מלמדת על שינוי|מסכמת את כל זמן ההופעה)/s.test(copy)) {
    failures.push("הכתבה כוללת הסבר מתודולוגי לקורא על צבירת מפת החום");
  }
  if (/(?:קירב(?:ה|ו)?|התקרב(?:ה|ו)?)\s+(?:את\s+)?(?:ה)?מאזן/.test(copy)) {
    failures.push("הכתבה משתמשת בפועל קירב או התקרב לתיאור מאזן מספרי");
  }
  return failures;
}

function sectionSupportsInsight(section, insightId) {
  if (!section.insightIds?.includes(insightId)) return false;
  const requiredEvidenceId = insightId === "chance_creation_mechanism"
    ? "mechanism.chance_creation"
    : insightId === "decisive_window_mechanism"
      ? "mechanism.decisive_window"
      : null;
  return !requiredEvidenceId || section.paragraphs.some((paragraph) => paragraph.evidenceIds.includes(requiredEvidenceId));
}

function preserveRequiredEditorialSections(previousEditorial, nextEditorial, analysisPlan) {
  let sections = [...nextEditorial.sections];
  const requiredInsightIds = analysisPlan.rankedInsights.map((insight) => insight.id);
  for (const insightId of requiredInsightIds) {
    if (sections.some((section) => sectionSupportsInsight(section, insightId))) continue;
    const previousSection = previousEditorial.sections.find((section) => sectionSupportsInsight(section, insightId));
    if (!previousSection) continue;
    sections = sections.filter((section) => !section.insightIds?.includes(insightId));
    sections.push(previousSection);
  }
  const usesHistoricalEvidence = (section) => section.paragraphs.some((paragraph) => (
    paragraph.evidenceIds.some((id) => id.startsWith("history.team.") || id.startsWith("history.player."))
  ));
  if (analysisPlan.historicalAudit.decision === "use" && !sections.some(usesHistoricalEvidence)) {
    const previousHistoricalSection = previousEditorial.sections.find(usesHistoricalEvidence);
    if (previousHistoricalSection) {
      const historicalInsightIds = new Set(previousHistoricalSection.insightIds ?? []);
      sections = sections.filter((section) => !section.insightIds?.some((id) => historicalInsightIds.has(id)));
      sections.push(previousHistoricalSection);
    }
  }
  const arcOrder = new Map();
  analysisPlan.narrativeArc.forEach((arcItem, arcIndex) => {
    arcItem.insightIds.forEach((id) => {
      if (!arcOrder.has(id)) arcOrder.set(id, arcIndex);
    });
  });
  sections = sections
    .map((section, originalIndex) => ({ section, originalIndex }))
    .sort((left, right) => {
      const leftOrder = Math.min(...left.section.insightIds.map((id) => arcOrder.get(id) ?? Number.MAX_SAFE_INTEGER));
      const rightOrder = Math.min(...right.section.insightIds.map((id) => arcOrder.get(id) ?? Number.MAX_SAFE_INTEGER));
      return leftOrder - rightOrder || left.originalIndex - right.originalIndex;
    })
    .map(({ section }) => section);
  if (sections.length > 5) {
    const requiredSet = new Set(requiredInsightIds);
    const requiredSections = sections.filter((section) => section.insightIds.some((id) => requiredSet.has(id)));
    const optionalSections = sections.filter((section) => !section.insightIds.some((id) => requiredSet.has(id)));
    sections = [...requiredSections, ...optionalSections].slice(0, 5);
  }
  return { ...nextEditorial, sections };
}

async function editEditorialUntilPassed(match, evidence, analysisPlan, gameStateContext, draft, qualityFeedback = []) {
  let currentDraft = draft;
  let currentAnalysisPlan = analysisPlan;
  let currentFeedback = [...qualityFeedback];
  let result = null;
  for (let attempt = 1; attempt <= MAX_EDITORIAL_ATTEMPTS; attempt += 1) {
    result = await editEditorialWithAi(match, evidence, currentAnalysisPlan, gameStateContext, currentDraft, currentFeedback);
    currentAnalysisPlan = { ...currentAnalysisPlan, graphics: result.graphics };
    result.editorial = preserveRequiredEditorialSections(currentDraft, result.editorial, currentAnalysisPlan);
    const structuralFailures = editorialStructureFailures(result.editorial, currentAnalysisPlan);
    if (structuralFailures.length) {
      result.review.status = "failed";
      result.review.notes = [...new Set([
        ...result.review.notes,
        ...structuralFailures.map((failure) => `בדיקה מבנית נכשלה — ${failure}`),
      ])];
    }
    result.analysisPlan = currentAnalysisPlan;
    console.log(JSON.stringify({
      editorialAttempt: attempt,
      status: result.review.status,
      notes: result.review.notes,
    }, null, 2));
    if (result.review.status === "passed") return result;
    currentDraft = result.editorial;
    currentFeedback = [...new Set([
      ...currentFeedback,
      ...result.review.notes.map((note) => `בדיקת העורך נכשלה — ${note}`),
    ])];
  }
  return result;
}

async function reviewEditorialQualityWithAi(match, evidence, analysisPlan, gameStateContext, editorial, attempt) {
  const model = process.env.OPENAI_QA_MODEL ?? process.env.OPENAI_EDITOR_MODEL ?? "gpt-5.6";
  const selectedEvidence = evidenceSelectedByPlan(evidence, analysisPlan);
  const response = await postOpenAi({
      model,
      store: false,
      instructions: [
        "אתה מבקר האיכות האחרון והבלתי־תלוי של מדור ספורט עברי. אינך עורך את הכתבה ואינך מתבקש להיות מנומס; תפקידך למנוע פרסום של נוסח שאינו ראוי.",
        "קרא כל משפט כאילו הוא עומד להתפרסם עכשיו באתר ספורט ישראלי. אפילו שגיאת התאמה אחת, מילה מומצאת אחת או צירוף שאינו קיים בעברית מחייבים naturalHebrew=false.",
        "פסול תרגום מילולי, מליצות ריקות ופעלים שאינם מתאימים לנתון. דוגמאות לסוגי כשל: 'השערים פונו', 'קבוצה כיתרה 51%', 'המצביה היו', 'ריבוי דו־קרקעי', 'גלים של איומים', 'להציב יותר נוכחות', 'לקבל יותר איומים' או 'שימור איזון בנפח'.",
        "בדוק גם התאמה בין הפועל למושא: מאזן או פער מספרי אינם 'מתקרבים' ואי אפשר 'לקרב' אותם. יש לתאר מה באמת השתנה, למשל שהקבוצה צמצמה את הפער במספר הבעיטות.",
        "footballHebrew=true רק אם הטקסט נשמע כמו ניתוח כדורגל ישראלי: מרכז השדה, אגפים או כנפיים, חילוצי כדור ומצבים. המילה 'נתיב' לתיאור אזור במגרש, 'לייצר בעיטות' או ניסוח מופשט של איום מחייבים false.",
        "numericClarity=true רק אם ברור לקורא מה כל מספר מודד, מהו בסיס ההשוואה, ומה ההבדל בין נתון של המשחק למדגם היסטורי.",
        "cohesiveNarrative=true רק אם לכתבה יש טענה מרכזית אחת, כל פסקה מקדמת אותה, ואין חזרות, סתירות או משפטי מילוי אוטומטיים.",
        "storyValue=true רק אם כל סעיף מסביר למה הנתונים חשובים לתזה. פסקה שמונה מדדים בלי להסביר מה הם מלמדים על המשחק מחייבת false.",
        "numberDiscipline=true רק אם המספרים נבחרו במשורה. פסקה עם 4 מספרים או יותר שאינה מפרידה בבירור בין טענה להסבר מחייבת false.",
        "שלוש נקודות הסיכום רשאיות לתמצת בקצרה טענות מהכתבה; אל תפסול אותן רק משום שהן מסכמות. פסול חזרה כמעט מילולית בתוך גוף הכתבה או מסקנה שאינה מוסיפה סינתזה.",
        "highVolumeComparisonsOnly=true רק אם מגמות שחקנים נשענות על מדדי נפח ועל notableChanges, ולא על שער, בישול או אירוע יחיד.",
        "evidenceFaithfulness=true רק אם הפרשנות נובעת מהראיות. פסול סיבתיות, שינוי טקטי, צד מגרש או תזמון שאינם נתמכים במפורש.",
        "gameStateContext=true רק אם הכתבה נותנת להקשר מצב המשחק את המשקל שקבע analysisPlan. כאשר rawShotTotalsNeedGameStateContext=true, אחד מ-2 הסעיפים הראשונים חייב להסביר מדוע הסכומים הסופיים מטעים; אזכור מאוחר אינו מספיק.",
        "graphicRelevance=true רק אם כל גרפיקה בתוכנית קשורה לתובנה שמופיעה בכתבה, הכותרת שלה מתארת את התובנה, והיא אינה קישוט או שכפול של טקסט.",
        "בדוק את הגרפיקות לפי הטווח שהקומפוננטה באמת מציגה: match_flow ומפת הבעיטות מציגות את המשחק המלא, גרפיקת היסטוריה את חלון משחקי העבר, מפת חום את זמן ההופעה כולו וגרפיקת שחקן את המשחק המלא. אם הכותרת מבטיחה סינון זמן שאינו קיים, פסול את הניסוח; אל תציע לעורך להוסיף סינון שהקומפוננטה אינה תומכת בו.",
        "explanatoryDepth=true רק אם הכתבה עונה על 'למה' או 'כיצד' בעזרת לפחות 2 סוגי ראיות מחוברים: למשל אזור הבעיטה וחוליית המסיים, או סדר האירועים וזהות השחקנים בחלון הדומיננטי. חזרה על xG, בעיטות ושערים ללא מנגנון מחייבת false.",
        "historicalAuditComplete=true רק אם השימוש בהיסטוריה תואם ל-analysisPlan.historicalAudit. decision=omit מחייב שלא תהיה בכתבה השוואה לעבר; decision=use מחייב מדגם, אות רלוונטי וסייג. עצם ההשמטה לאחר בדיקה אינה סיבה לפסול.",
        "אל תדרוש הערה מתודולוגית על מפות החום. להפך: פסול הסבר לקורא על כך שהמפה מצטברת, אינה תלויה בזמן או אינה מוכיחה שינוי. יש להציג רק תובנה מבנית בטוחה ולהימנע מטענת שינוי בזמן.",
        "issues חייב להכיל כל בעיה שמצאת, עם ציטוט קצר מהנוסח והסבר מעשי לעורך. אם issues אינו ריק, לפחות בדיקה אחת חייבת להיות false. אל תכתוב מחמאות ב-issues.",
        "אשר את הכתבה רק אם עורך אנושי דובר עברית לא היה צריך לשנות אף משפט לפני הפרסום.",
        FOOTBALL_HEBREW_GUIDE,
      ].join("\n"),
      input: JSON.stringify({
        match: {
          competition: match.competition_name_he ?? match.competition_name,
          scheduledAt: match.scheduled_at,
          home: match.home_team_name_he ?? match.home_team_name,
          away: match.away_team_name_he ?? match.away_team_name,
        },
        evidence: selectedEvidence,
        analysisPlan,
        gameStateContext,
        editorial,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "hebrew_independent_quality_review",
          strict: true,
          schema: qualityReviewResponseSchema,
        },
      },
    }, "OpenAI independent quality review");
  const payload = await response.json();
  const outputText = responseOutputText(payload);
  if (!outputText) throw new Error("The independent quality review returned no structured output.");
  const reviewed = JSON.parse(outputText);
  const passed = Object.values(reviewed.checks).every(Boolean) && reviewed.issues.length === 0;
  return {
    mode: "openai_independent_quality_gate",
    model,
    status: passed ? "passed" : "failed",
    checks: reviewed.checks,
    issues: reviewed.issues,
    attempt,
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
        footballHebrew: true,
        numericClarity: true,
        cohesiveNarrative: true,
        storyValue: true,
        numberDiscipline: true,
        highVolumeComparisonsOnly: true,
        evidenceFaithfulness: true,
        gameStateContext: true,
        graphicRelevance: true,
        explanatoryDepth: true,
        historicalAuditComplete: true,
      },
      notes: ["נוסח הדוגמה נערך כחלק מהקוד; מעבר עריכת ה־AI אינו רץ במצב --no-ai."],
    },
  };
}

function fixtureQualityReview() {
  return {
    mode: "mechanical_fixture_without_ai_quality_gate",
    model: null,
    status: "passed",
    checks: {
      naturalHebrew: true,
      footballHebrew: true,
      numericClarity: true,
      cohesiveNarrative: true,
      storyValue: true,
      numberDiscipline: true,
      highVolumeComparisonsOnly: true,
      evidenceFaithfulness: true,
      gameStateContext: true,
      graphicRelevance: true,
      explanatoryDepth: true,
      historicalAuditComplete: true,
    },
    issues: [],
    attempt: 0,
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

function validateAnalysisPlan(analysisPlan, evidence, insightCandidates, gameStateContext, players = [], historicalContext = null) {
  const failures = [];
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const candidateIds = new Set(insightCandidates.map((candidate) => candidate.id));
  const candidateById = new Map(insightCandidates.map((candidate) => [candidate.id, candidate]));
  const plannedInsightIds = new Set(analysisPlan.rankedInsights.map((insight) => insight.id));
  const categories = analysisPlan.coverageDecisions.map((item) => item.category);
  const requiredCategories = ["game_state", "flow", "quality", "style", "matchup", "spatial", "history", "player"];
  if (new Set(categories).size !== requiredCategories.length || !requiredCategories.every((category) => categories.includes(category))) {
    failures.push("coverageDecisions must contain every analysis category exactly once");
  }
  if (plannedInsightIds.size !== analysisPlan.rankedInsights.length) failures.push("rankedInsights contains duplicates");
  if (!analysisPlan.rankedInsights.every((insight) => candidateIds.has(insight.id))) failures.push("rankedInsights contains an unknown candidate");
  const selectedCategories = new Set(analysisPlan.rankedInsights.map((insight) => candidateById.get(insight.id)?.category));
  for (const decision of analysisPlan.coverageDecisions) {
    if ((selectedCategories.has(decision.category)) !== (decision.decision === "use")) {
      failures.push(`coverage decision for ${decision.category} does not match the selected insights`);
    }
  }
  const referencedEvidenceIds = [
    ...analysisPlan.thesis.evidenceIds,
    ...analysisPlan.rankedInsights.flatMap((insight) => insight.evidenceIds),
    ...analysisPlan.explanatoryModel.evidenceIds,
    ...analysisPlan.explanatoryModel.components.flatMap((component) => component.evidenceIds),
    ...analysisPlan.historicalAudit.evidenceIds,
    ...analysisPlan.graphics.flatMap((graphic) => graphic.evidenceIds),
    ...analysisPlan.coverageDecisions.flatMap((decision) => decision.evidenceIds),
  ];
  if (referencedEvidenceIds.some((id) => !evidenceIds.has(id))) failures.push("analysis plan references unknown evidence");
  if (analysisPlan.narrativeArc.some((step) => step.insightIds.some((id) => !plannedInsightIds.has(id)))) failures.push("narrativeArc references an unselected insight");
  if (analysisPlan.graphics.some((graphic) => !plannedInsightIds.has(graphic.placementInsightId))) failures.push("a graphic is not attached to a selected insight");
  if (new Set(analysisPlan.graphics.map((graphic) => graphic.type)).size !== analysisPlan.graphics.length) failures.push("graphic types must be distinct within one article");
  if (analysisPlan.graphics.some((graphic) => extractNumbers(`${graphic.titleHe} ${graphic.subtitleHe}`).length > 0)) failures.push("graphic titles and subtitles must not contain numbers");
  const knownPlayerIds = new Set(players.map((player) => player.playerId));
  if (analysisPlan.graphics.some((graphic) => graphic.type === "player_focus" && (!graphic.focusPlayerId || !knownPlayerIds.has(graphic.focusPlayerId)))) failures.push("a player graphic references an unknown player");
  if (historicalContext && analysisPlan.graphics.some((graphic) => graphic.type === "team_history" && (
    !graphic.metricCodes.length
    || graphic.metricCodes.some((code) => !historicalContext.teams.home.metrics[code] && !historicalContext.teams.away.metrics[code])
  ))) failures.push("a history graphic references an unavailable metric");
  if (!Object.values(analysisPlan.quality).every(Boolean)) failures.push("the analyst did not pass its own planning checks");
  if (analysisPlan.rankedInsights.filter((insight) => insight.importance === "primary").length !== 1) failures.push("the plan must have exactly one primary insight");
  if (plannedInsightIds.has("chance_creation_mechanism") && plannedInsightIds.has("chance_quality_gap")) failures.push("chance_creation_mechanism supersedes the descriptive chance_quality_gap insight");
  if (plannedInsightIds.has("decisive_window_mechanism") && plannedInsightIds.has("decisive_match_window")) failures.push("decisive_window_mechanism supersedes the descriptive decisive_match_window insight");
  const requiredMechanismCandidates = insightCandidates.filter((candidate) => (
    ["chance_creation_mechanism", "decisive_window_mechanism"].includes(candidate.id)
    && candidate.score >= 75
  ));
  for (const candidate of requiredMechanismCandidates) {
    const planned = analysisPlan.rankedInsights.find((insight) => insight.id === candidate.id);
    const requiredEvidenceId = candidate.id === "chance_creation_mechanism" ? "mechanism.chance_creation" : "mechanism.decisive_window";
    if (!planned || !planned.evidenceIds.includes(requiredEvidenceId)) {
      failures.push(`${candidate.id} must be selected with ${requiredEvidenceId} when the mechanism signal is strong`);
    }
    if (!analysisPlan.explanatoryModel.evidenceIds.includes(requiredEvidenceId)
      || !analysisPlan.explanatoryModel.components.some((component) => component.evidenceIds.includes(requiredEvidenceId))) {
      failures.push(`explanatoryModel does not incorporate ${requiredEvidenceId}`);
    }
  }
  const explanatoryFamilies = new Set(analysisPlan.explanatoryModel.evidenceIds.map((id) => id.split(".")[0]));
  if (explanatoryFamilies.size < 2 || !analysisPlan.explanatoryModel.evidenceIds.some((id) => id.startsWith("mechanism."))) {
    failures.push("explanatoryModel must triangulate mechanism evidence with at least one other evidence family");
  }
  if (!analysisPlan.historicalAudit.teamSignalsReviewed || !analysisPlan.historicalAudit.playerSignalsReviewed
    || !analysisPlan.historicalAudit.evidenceIds.includes("history.audit")) {
    failures.push("historicalAudit must explicitly review team and player signals using history.audit");
  }
  const historyDecision = analysisPlan.coverageDecisions.find((decision) => decision.category === "history")?.decision;
  if (historyDecision !== analysisPlan.historicalAudit.decision) failures.push("historicalAudit decision does not match history coverage");
  if (gameStateContext.rawShotTotalsNeedGameStateContext) {
    const gameStateInsight = analysisPlan.rankedInsights.find((insight) => insight.id === "game_state_distortion");
    if (!gameStateInsight || gameStateInsight.importance !== "primary" || !gameStateInsight.evidenceIds.includes("flow.game_state_context")) {
      failures.push("misleading cumulative totals were not promoted to a primary game-state insight");
    }
    if (!analysisPlan.narrativeArc.slice(0, 2).some((step) => step.insightIds.includes("game_state_distortion"))) {
      failures.push("the game-state distortion is not positioned in the opening of the narrative");
    }
  }
  return failures;
}

function buildChecks(match, home, away, players, shots, evidence, editorial, editorialReview, qualityReview, flowWindows, timelineEvents, spatialProfile, historicalContext, tags, requiresAiReview, analysisPlan, insightCandidates, gameStateContext) {
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
  const usedEvidenceIds = new Set(claimEntries(editorial).flatMap((claim) => claim.evidenceIds));
  const structuredEvidenceIds = ["team.volume", "team.quality", "team.progression", "matchup.midfield", "matchup.home_attack_away_defense", "matchup.away_attack", "flow.shot_windows", "flow.game_state_context", "mechanism.chance_creation", "mechanism.decisive_window", "heatmap.spatial_profile", "history.audit"];
  const structuredEvidenceReady = structuredEvidenceIds.every((id) => evidence.find((item) => item.id === id)?.context);
  const planFailures = requiresAiReview ? validateAnalysisPlan(analysisPlan, evidence, insightCandidates, gameStateContext, players, historicalContext) : [];
  const plannedInsightIds = new Set(analysisPlan.rankedInsights.map((insight) => insight.id));
  const sectionInsightIds = editorial.sections.flatMap((section) => section.insightIds ?? []);
  const primaryInsightIds = analysisPlan.rankedInsights.filter((insight) => insight.importance === "primary").map((insight) => insight.id);
  const planFollowed = !requiresAiReview || (
    sectionInsightIds.every((id) => plannedInsightIds.has(id))
    && primaryInsightIds.every((id) => sectionInsightIds.includes(id))
  );
  const gameStateStoryPassed = !requiresAiReview || !gameStateContext.rawShotTotalsNeedGameStateContext || (
    editorial.sections.slice(0, 2).some((section) => (
      section.insightIds?.includes("game_state_distortion")
      && section.paragraphs.some((paragraph) => paragraph.evidenceIds.includes("flow.game_state_context"))
    ))
  );
  const requiredMechanismInsightIds = insightCandidates
    .filter((candidate) => ["chance_creation_mechanism", "decisive_window_mechanism"].includes(candidate.id) && candidate.score >= 75)
    .map((candidate) => candidate.id);
  const mechanismStoryPassed = !requiresAiReview || requiredMechanismInsightIds.every((insightId) => {
    const evidenceId = insightId === "chance_creation_mechanism" ? "mechanism.chance_creation" : "mechanism.decisive_window";
    return editorial.sections.some((section) => (
      section.insightIds?.includes(insightId)
      && section.paragraphs.some((paragraph) => paragraph.evidenceIds.includes(evidenceId))
    ));
  });
  const historicalEvidenceUsed = [...usedEvidenceIds].some((id) => id.startsWith("history.team.") || id.startsWith("history.player."));
  const historicalAuditPassed = !requiresAiReview || (
    analysisPlan.historicalAudit.teamSignalsReviewed
    && analysisPlan.historicalAudit.playerSignalsReviewed
    && analysisPlan.historicalAudit.evidenceIds.includes("history.audit")
    && (analysisPlan.historicalAudit.decision === "use" ? historicalEvidenceUsed : !historicalEvidenceUsed)
  );
  const paragraphNumbers = editorial.sections.flatMap((section) => section.paragraphs.map((paragraph) => extractNumbers(paragraph.text).length));
  const disciplinedNumbers = !requiresAiReview || (paragraphNumbers.every((count) => count <= 6)
    && (paragraphNumbers.reduce((sum, count) => sum + count, 0) / Math.max(paragraphNumbers.length, 1)) <= 4);
  const bodyNumbers = editorial.sections.flatMap((section) => section.paragraphs.flatMap((paragraph) => extractNumbers(paragraph.text)));
  const takeawaysOnlySummarize = !requiresAiReview || editorial.takeaways.every((takeaway) => (
    extractNumbers(takeaway.text).every((value) => bodyNumbers.some((candidate) => numbersMatch(candidate, value)))
  ));
  const knownPlayerIds = new Set(players.map((player) => player.playerId));
  const plannedInsightById = new Map(analysisPlan.rankedInsights.map((insight) => [insight.id, insight]));
  const graphicPlanReady = !requiresAiReview || analysisPlan.graphics.every((graphic) => (
    (graphic.type !== "player_focus" || (graphic.focusPlayerId && knownPlayerIds.has(graphic.focusPlayerId)))
    && (graphic.type !== "team_history" || (
      graphic.metricCodes.length > 0
      && graphic.metricCodes.every((code) => historicalContext.teams.home.metrics[code] || historicalContext.teams.away.metrics[code])
    ))
    && graphic.evidenceIds.some((id) => plannedInsightById.get(graphic.placementInsightId)?.evidenceIds.includes(id))
  ));
  const awkwardPatterns = [
    /הפך מחריגה לסיפור/,
    /ההיסטוריה הקצרה שלהם/,
    /המספרים מספרים/,
    /צבר(?:ה|ו)? את רוב האיום/,
    /צבר(?:ה|ו)? את רוב הבעיטות/,
    /xG\s*;/,
    /השערים פונו/,
    /כיתרה\s+\d/,
    /המצביה/,
    /ריבוי דו[־-]קרקעי/,
    /גלים של איומים/,
    /שימור איזון בנפח/,
    /הציב(?:ה|ו)?\s+יותר\s+נוכחות/,
    /קיבל(?:ה|ו)?[^.]{0,80}יותר\s+איומים/,
    /נתיב(?:ים|י|י־|ה)?/,
    /ייצר(?:ה|ו)?[^.]{0,40}בעיטות/,
    /מצב של המשחק/,
    /מאזני בעיטות/,
    /(?:קירב(?:ה|ו)?|התקרב(?:ה|ו)?)\s+(?:את\s+)?(?:ה)?מאזן/,
    /מפת?\s*ה?(?:חום|פעילות).*?(?:אינה תלויה בזמן|אינה מלמדת על שינוי|מסכמת את מיקומי השחקנים לאורך)/s,
  ];
  const editorialReviewPassed = !requiresAiReview || (editorialReview.mode === "openai_second_pass_editor"
    && editorialReview.status === "passed"
    && Object.values(editorialReview.checks).every(Boolean));
  const qualityReviewPassed = !requiresAiReview || (qualityReview.mode === "openai_independent_quality_gate"
    && qualityReview.status === "passed"
    && Object.values(qualityReview.checks).every(Boolean)
    && qualityReview.issues.length === 0);
  const checks = [
    ["match-ended", "המשחק הסתיים", match.status === "Ended", `סטטוס המקור: ${match.status}`],
    ["score-vs-events", "התוצאה תואמת לאירועי השערים", home.score === homeGoals && away.score === awayGoals, `${homeGoals}:${awayGoals} באירועים`],
    ["score-vs-players", "סך שערי השחקנים תואם לתוצאה", playerGoals === home.score + away.score, `${playerGoals} שערים בשורות השחקנים`],
    ["shots-home", `בעיטות ${home.nameHe} תואמות למפת הבעיטות`, home.stats.team_total_shots === home.shotSummary.count, `${home.shotSummary.count} בעיטות`],
    ["shots-away", `בעיטות ${away.nameHe} תואמות למפת הבעיטות`, away.stats.team_total_shots === away.shotSummary.count, `${away.shotSummary.count} בעיטות`],
    ["target-home", `בעיטות ${home.nameHe} למסגרת תואמות`, home.stats.team_shots_on_target === home.shotSummary.onTarget, `${home.shotSummary.onTarget} למסגרת`],
    ["target-away", `בעיטות ${away.nameHe} למסגרת תואמות`, away.stats.team_shots_on_target === away.shotSummary.onTarget, `${away.shotSummary.onTarget} למסגרת`],
    ["xg-home", `xG ${home.nameHe} עקבי בין המקורות`, Math.abs(home.stats.team_expected_goals - home.shotSummary.xg) <= 0.05, `${home.stats.team_expected_goals} מול ${home.shotSummary.xg}`],
    ["xg-away", `xG ${away.nameHe} עקבי בין המקורות`, Math.abs(away.stats.team_expected_goals - away.shotSummary.xg) <= 0.05, `${away.stats.team_expected_goals} מול ${away.shotSummary.xg}`],
    ["player-goal-events", "שערי השחקנים תואמים לאירועי הבעיטה", playerGoalEventsMatch, `${playerGoals} שערים נבדקו ברמת השחקן`],
    ["flow-shot-total", "חלונות הזמן מכסים את כל הבעיטות", windowShotTotal === shots.length, `${windowShotTotal} בעיטות בחלונות הזמן`],
    ["timeline-goals", "אירועי המשחק תואמים לשערים", timelineGoalTotal === home.score + away.score, `${timelineGoalTotal} שערים בציר האירועים`],
    ["heatmap-coverage", "כיסוי מפות החום מספיק לניתוח מבני", Number(spatialProfile?.starterHeatmaps ?? 0) >= 18, `${spatialProfile?.starterHeatmaps ?? 0} שחקני הרכב עם מפה`],
    ["history-order", "כל משחקי ההשוואה קדמו למשחק", historyPrecedesMatch, `${historicalMatches.length} משחקים קודמים נבדקו`],
    ["historical-player-volume", "השוואות שחקנים נשענות על מדדי נפח", weakHistoricalPlayerClaims.length === 0, weakHistoricalPlayerClaims.length ? `${weakHistoricalPlayerClaims.length} השוואות נשענו על מדגם חלש` : "לא נמצאו מגמות אישיות ממדגם קטן"],
    ["hebrew-copy-lint", "הנוסח נקי מתבניות עברית בעייתיות", awkwardPatterns.every((pattern) => !pattern.test(copy)), "נבדקו ניסוחים ומעברים מספריים בעייתיים"],
    ["editorial-review", "הנוסח עבר בקרת עברית, בהירות ורצף", editorialReviewPassed, editorialReview.notes.join(" | ")],
    ["independent-quality-review", "מבקר איכות בלתי־תלוי אישר את הנוסח", qualityReviewPassed, qualityReview.issues.length ? qualityReview.issues.join(" | ") : `אושר בניסיון ${qualityReview.attempt}`],
    ["analysis-plan", "האנליסט בחר תזה, תובנות והשמטות תקינות", planFailures.length === 0, planFailures.length ? planFailures.join(" | ") : `${analysisPlan.rankedInsights.length} תובנות ו-${analysisPlan.coverageDecisions.filter((item) => item.decision === "omit").length} קטגוריות שהושמטו`],
    ["plan-followed", "הכתבה עוקבת אחר התזה והקשת הסיפורית", planFollowed, `${sectionInsightIds.length} שיוכי תובנה נבדקו`],
    ["game-state-story", "מצב המשחק מקבל משקל לפני המספרים המצטברים", gameStateStoryPassed, gameStateContext.rawShotTotalsNeedGameStateContext ? "נתוני הבעיטות דורשים הקשר באחד מ-2 הסעיפים הראשונים" : "לא זוהה עיוות מהותי בסכומי הבעיטות"],
    ["explanatory-depth", "הכתבה מסבירה כיצד נוצרו המצבים והחלון הדומיננטי", mechanismStoryPassed, `${requiredMechanismInsightIds.length} תובנות מנגנון נדרשו וקושרו לראיות`],
    ["historical-audit", "נתוני העבר נבדקו והשימוש בהם תואם למסקנת האנליסט", historicalAuditPassed, `${analysisPlan.historicalAudit.decision}: ${analysisPlan.historicalAudit.findingHe}`],
    ["number-discipline", "המספרים תומכים בסיפור ואינם מחליפים אותו", disciplinedNumbers, `מספרים בפסקאות: ${paragraphNumbers.join(", ")}`],
    ["takeaways-summarize", "התקציר אינו מציג מספרים חדשים", takeawaysOnlySummarize, "כל מספר בתקציר הופיע קודם בגוף הכתבה"],
    ["graphic-plan", "הגרפיקות נבחרו עבור תובנות ושחקנים קיימים", graphicPlanReady, `${analysisPlan.graphics.length} גרפיקות מתוכננות`],
    ["structured-evidence-context", "ראיות הניתוח כוללות שמות מדדים וקבוצות", structuredEvidenceReady, `${structuredEvidenceIds.length} חבילות ראיות מובנות נבדקו`],
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

function fixtureAnalysisPlan(insightCandidates) {
  const ids = insightCandidates.slice(0, 3).map((candidate) => candidate.id);
  const fallbackIds = ids.length ? ids : ["decisive_match_window"];
  return {
    thesis: { claimHe: "תוכנית בדיקה מכנית", whyItMattersHe: "מצב זה אינו מיועד לפרסום", evidenceIds: ["match.result"] },
    rankedInsights: fallbackIds.map((id, index) => ({
      id,
      titleHe: id,
      findingHe: id,
      whyItMattersHe: id,
      evidenceIds: ["match.result"],
      importance: index === 0 ? "primary" : "supporting",
      narrativeRole: index === 0 ? "setup" : "explanation",
    })),
    explanatoryModel: {
      questionHe: "מה מסביר את המשחק",
      answerHe: "מצב בדיקה מכנית",
      supportLevel: "descriptive",
      evidenceIds: ["match.result", "team.quality"],
      components: [
        { findingHe: "מצב בדיקה", whyItExplainsHe: "בדיקה מכנית", confidence: "low", limitationHe: "אינו לפרסום", evidenceIds: ["match.result"] },
        { findingHe: "מצב בדיקה", whyItExplainsHe: "בדיקה מכנית", confidence: "low", limitationHe: "אינו לפרסום", evidenceIds: ["team.quality"] },
      ],
    },
    historicalAudit: {
      decision: "omit",
      teamSignalsReviewed: true,
      playerSignalsReviewed: true,
      findingHe: "מצב בדיקה מכנית",
      evidenceIds: ["history.audit"],
    },
    narrativeArc: fallbackIds.map((id) => ({ headingIdeaHe: id, purposeHe: id, insightIds: [id] })),
    graphics: [],
    coverageDecisions: ["game_state", "flow", "quality", "style", "matchup", "spatial", "history", "player"].map((category) => ({
      category,
      decision: "omit",
      reasonHe: "מצב בדיקה מכנית",
      evidenceIds: [],
    })),
    quality: {
      singleThesis: true,
      explainsRatherThanLists: true,
      gameStateAdjusted: true,
      selectiveEvidence: true,
      graphicsServeStory: true,
      explanatoryDepth: true,
      historicalAuditComplete: true,
    },
  };
}

async function main() {
  await loadLocalEnv();
  const args = readArguments();
  if (args.noAi && !args.dryRun) {
    throw new Error("--no-ai is only available with --dry-run for mechanical fixture checks; it cannot publish an article.");
  }
  if (!args.noAi && !process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required: published articles must run both the AI writer and the independent AI editor.");
  }
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
  const gameStateContext = buildGameStateContext(dataset.shots, timelineEvents, home, away);
  const mechanismContext = buildMechanismContext({
    shots: dataset.shots,
    players,
    home,
    away,
    unitMatchups,
    spatialProfile,
    flowWindows,
    timelineEvents,
    gameStateContext,
  });
  const historicalAuditContext = buildHistoricalAuditContext(historicalContext);
  const insightCandidates = buildInsightCandidates({
    home,
    away,
    flowWindows,
    gameStateContext,
    historicalContext,
    unitMatchups,
    spatialProfile,
    mechanismContext,
  });
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
    historicalAuditContext,
    gameStateContext,
    mechanismContext,
  );
  const usedAi = !args.noAi;
  let analysisResult = { plan: fixtureAnalysisPlan(insightCandidates), model: null };
  if (usedAi) {
    let analysisFeedback = [];
    for (let attempt = 1; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt += 1) {
      analysisResult = await generateAnalysisPlanWithAi(match, evidence, insightCandidates, gameStateContext, analysisFeedback);
      analysisFeedback = validateAnalysisPlan(analysisResult.plan, evidence, insightCandidates, gameStateContext, players, historicalContext);
      console.log(JSON.stringify({ analysisAttempt: attempt, status: analysisFeedback.length ? "failed" : "passed", issues: analysisFeedback }, null, 2));
      if (!analysisFeedback.length) break;
    }
    if (analysisFeedback.length) {
      throw new Error(`Analysis plan rejected after ${MAX_ANALYSIS_ATTEMPTS} attempts:\n${analysisFeedback.map((issue) => `- ${issue}`).join("\n")}`);
    }
  }
  let analysisPlan = analysisResult.plan;
  const draftEditorial = usedAi
    ? await generateEditorialWithAi(match, evidence, analysisPlan, gameStateContext)
    : fallbackEditorial(match, home, away);
  const reviewed = usedAi
    ? await editEditorialUntilPassed(match, evidence, analysisPlan, gameStateContext, draftEditorial)
    : curatedEditorialSeed(draftEditorial);
  if (usedAi) analysisPlan = reviewed.analysisPlan;
  let { editorial, review: editorialReview } = reviewed;
  let qualityReview = fixtureQualityReview();
  let tags = [];
  let checks = [];
  let failedChecks = [];
  if (usedAi) {
    for (let attempt = 1; attempt <= MAX_QUALITY_ATTEMPTS; attempt += 1) {
      qualityReview = await reviewEditorialQualityWithAi(match, evidence, analysisPlan, gameStateContext, editorial, attempt);
      console.log(JSON.stringify({
        qualityAttempt: attempt,
        status: qualityReview.status,
        issues: qualityReview.issues,
      }, null, 2));
      let currentFeedback = [];
      if (qualityReview.status === "passed") {
        tags = buildArticleTags(home, away, players, editorial);
        checks = buildChecks(match, home, away, players, dataset.shots, evidence, editorial, editorialReview, qualityReview, flowWindows, timelineEvents, spatialProfile, historicalContext, tags, true, analysisPlan, insightCandidates, gameStateContext);
        failedChecks = checks.filter((check) => check.status === "failed");
        if (failedChecks.length === 0) break;
        console.log(JSON.stringify({ deterministicAttempt: attempt, failedChecks }, null, 2));
        currentFeedback = failedChecks.map((check) => `בדיקה דטרמיניסטית נכשלה — ${check.label}: ${check.detail}`);
      } else {
        currentFeedback = qualityReview.issues;
      }
      if (attempt === MAX_QUALITY_ATTEMPTS) break;
      const revised = await editEditorialUntilPassed(match, evidence, analysisPlan, gameStateContext, editorial, [...new Set(currentFeedback)]);
      editorial = revised.editorial;
      editorialReview = revised.review;
      analysisPlan = revised.analysisPlan;
    }
    if (qualityReview.status === "failed") {
      throw new Error(`Article rejected by independent Hebrew quality gate after ${MAX_QUALITY_ATTEMPTS} attempts:\n${qualityReview.issues.map((issue) => `- ${issue}`).join("\n")}`);
    }
  } else {
    tags = buildArticleTags(home, away, players, editorial);
    checks = buildChecks(match, home, away, players, dataset.shots, evidence, editorial, editorialReview, qualityReview, flowWindows, timelineEvents, spatialProfile, historicalContext, tags, false, analysisPlan, insightCandidates, gameStateContext);
    failedChecks = checks.filter((check) => check.status === "failed");
  }
  if (failedChecks.length) {
    throw new Error(`Article rejected after ${MAX_QUALITY_ATTEMPTS} combined editorial and fact-check attempts:\n${failedChecks.map((check) => `- ${check.label}: ${check.detail}`).join("\n")}`);
  }

  const generatedAt = new Date().toISOString();
  const article = {
    schemaVersion: 1,
    slug,
    language: "he",
    kind: "match_review",
    status: usedAi ? "published" : "draft",
    publishedAt: generatedAt,
    generatedAt,
    generation: {
      mode: usedAi ? "openai_analyst_writer_editor_and_qa" : "mechanical_fixture_dry_run",
      analystModel: analysisResult.model,
      model: usedAi ? (process.env.OPENAI_MODEL ?? "gpt-5.6") : null,
      editorModel: usedAi ? (process.env.OPENAI_EDITOR_MODEL ?? "gpt-5.6") : null,
      qualityModel: usedAi ? (process.env.OPENAI_QA_MODEL ?? process.env.OPENAI_EDITOR_MODEL ?? "gpt-5.6") : null,
      pipelineVersion: "match-review-v16",
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
    historicalAuditContext,
    gameStateContext,
    mechanismContext,
    insightCandidates,
    analysisPlan,
    shots: dataset.shots.map(normalizeShot),
    editorialReview,
    qualityReview,
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
