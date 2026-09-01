#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workbenchRoot = path.join(projectRoot, ".content-workbench");
const timezone = "Asia/Jerusalem";
const baselineMatchLimit = 5;
const fullStatThreshold = 10;
const trendMetricRules = {
  touches: { minPriorTotal: 120, minDeltaPer90: 12 },
  passes_attempted: { minPriorTotal: 100, minDeltaPer90: 10 },
  passes_completed: { minPriorTotal: 80, minDeltaPer90: 9 },
  passes_into_final_third: { minPriorTotal: 20, minDeltaPer90: 3 },
  key_passes: { minPriorTotal: 6, minDeltaPer90: 1.5 },
  total_shots: { minPriorTotal: 8, minDeltaPer90: 1.5 },
  successful_dribbles: { minPriorTotal: 8, minDeltaPer90: 1.5 },
  was_fouled: { minPriorTotal: 8, minDeltaPer90: 1.5 },
  ground_duels_attempted: { minPriorTotal: 24, minDeltaPer90: 3 },
  ground_duels_won: { minPriorTotal: 12, minDeltaPer90: 2 },
  aerial_duels_attempted: { minPriorTotal: 12, minDeltaPer90: 2 },
  aerial_duels_won: { minPriorTotal: 7, minDeltaPer90: 1.5 },
  tackles_attempted: { minPriorTotal: 10, minDeltaPer90: 2 },
  tackles_won: { minPriorTotal: 6, minDeltaPer90: 1.5 },
  ball_recovery: { minPriorTotal: 18, minDeltaPer90: 2.5 },
  interceptions: { minPriorTotal: 8, minDeltaPer90: 1.5 },
  clearances: { minPriorTotal: 12, minDeltaPer90: 2 },
};
const volumeMetrics = [
  "touches",
  "passes_attempted",
  "passes_completed",
  "passes_into_final_third",
  "key_passes",
  "total_shots",
  "shots_on_target",
  "big_chances_missed",
  "big_chances_scored",
  "expected_goals",
  "expected_goals_on_target",
  "expected_assists",
  "successful_dribbles",
  "was_fouled",
  "ground_duels_attempted",
  "ground_duels_won",
  "aerial_duels_attempted",
  "aerial_duels_won",
  "tackles_attempted",
  "tackles_won",
  "ball_recovery",
  "interceptions",
  "clearances",
  "goalkeeper_saves",
  "goals_conceded",
  "expected_goals_on_target_conceded",
  "expected_goals_prevented",
  "goals",
  "assists",
  "rating_365",
];

function parseArguments() {
  const args = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  return { endDate: valueAfter("--end-date"), seasonName: valueAfter("--season") };
}

function isoDateInTimezone(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validateDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
}

async function loadLocalEnv() {
  const contents = await readFile(path.join(projectRoot, ".env"), "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

async function selectAll(queryFactory) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await queryFactory(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function groupAppearances(rows, playerNameById, lineupByAppearanceId) {
  const byMatch = new Map();
  for (const row of rows) {
    const key = `${row.player_id}:${row.match_id}`;
    if (!byMatch.has(key)) {
      const homeScore = row.home_score === null ? null : Number(row.home_score);
      const awayScore = row.away_score === null ? null : Number(row.away_score);
      byMatch.set(key, {
        playerId: row.player_id,
        nameHe: playerNameById.get(row.player_id) ?? row.display_name,
        appearanceId: row.appearance_id,
        matchId: row.match_id,
        scheduledAt: row.scheduled_at,
        teamName: row.team_name,
        opponentName: row.opponent_team_name,
        side: row.side,
        minutes: Number(row.minutes_played ?? 0),
        started: /start/i.test(lineupByAppearanceId.get(row.appearance_id) ?? ""),
        scoreFor: row.side === "home" ? homeScore : awayScore,
        scoreAgainst: row.side === "home" ? awayScore : homeScore,
        metrics: {},
      });
    }
    if (row.metric_code && volumeMetrics.includes(row.metric_code) && row.value_numeric !== null) {
      byMatch.get(key).metrics[row.metric_code] = Number(row.value_numeric);
    }
  }

  const deduped = new Map();
  const removed = [];
  for (const appearance of byMatch.values()) {
    const fixtureKey = [
      appearance.playerId,
      appearance.scheduledAt,
      appearance.scoreFor,
      appearance.scoreAgainst,
    ].join(":");
    const incumbent = deduped.get(fixtureKey);
    if (!incumbent || Object.keys(appearance.metrics).length > Object.keys(incumbent.metrics).length) {
      if (incumbent) removed.push(incumbent.matchId);
      deduped.set(fixtureKey, appearance);
    } else {
      removed.push(appearance.matchId);
    }
  }
  return { appearances: [...deduped.values()], duplicateMatchIdsRemoved: removed };
}

function aggregateMatches(matches) {
  const minutes = matches.reduce((sum, match) => sum + match.minutes, 0);
  const totals = {};
  for (const metric of volumeMetrics) {
    const samples = matches.filter((match) => Number.isFinite(match.metrics[metric]));
    if (!samples.length) continue;
    if (metric === "rating_365") {
      const weightedMinutes = samples.reduce((sum, match) => sum + Math.max(1, match.minutes), 0);
      totals[metric] = samples.reduce((sum, match) => sum + match.metrics[metric] * Math.max(1, match.minutes), 0) / weightedMinutes;
    } else {
      totals[metric] = samples.reduce((sum, match) => sum + match.metrics[metric], 0);
    }
  }
  const per90 = Object.fromEntries(Object.entries(totals)
    .filter(([metric]) => metric !== "rating_365")
    .map(([metric, value]) => [metric, minutes > 0 ? Number(value) * 90 / minutes : 0]));
  return { minutes, totals, per90 };
}

function roundedRecord(record, digits = 2) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Number(Number(value).toFixed(digits))]));
}

function insightCandidates(players) {
  const candidates = [];
  for (const player of players) {
    const changes = Object.keys(player.per90).flatMap((metricCode) => {
      const rule = trendMetricRules[metricCode];
      const prior = player.baseline.per90[metricCode];
      const priorTotal = Number(prior) * player.baseline.minutes / 90;
      if (!rule || player.minutes < 60 || player.baseline.matchCount < 3 || !Number.isFinite(prior) || prior === 0 || priorTotal < rule.minPriorTotal) return [];
      const current = player.per90[metricCode];
      const changePercent = (current - prior) / Math.abs(prior) * 100;
      const deltaPer90 = current - prior;
      if (Math.abs(changePercent) < 35 || Math.abs(deltaPer90) < rule.minDeltaPer90) return [];
      return [{ metricCode, current, prior, priorTotal, deltaPer90, changePercent }];
    }).sort((left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent));
    if (changes[0]) {
      candidates.push({
        id: `trend:${player.playerId}:${changes[0].metricCode}`,
        category: "trend",
        playerId: player.playerId,
        score: Math.min(100, 45 + Math.abs(changes[0].changePercent) / 2 + Math.min(20, player.minutes / 9)),
        context: changes[0],
        evidenceIds: [`player.week.${player.playerId}`],
      });
    }
    if (player.minutes >= 60 && Number.isFinite(player.metrics.rating_365)) {
      candidates.push({
        id: `performance:${player.playerId}`,
        category: "performance",
        playerId: player.playerId,
        score: Math.min(100, 20 + player.metrics.rating_365 * 8 + Math.min(10, player.minutes / 18)),
        context: { rating: player.metrics.rating_365, minutes: player.minutes },
        evidenceIds: [`player.week.${player.playerId}`],
      });
    }
  }
  return candidates.sort((left, right) => right.score - left.score);
}

async function main() {
  const args = parseArguments();
  await loadLocalEnv();
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
  const client = createClient(url, key, { auth: { persistSession: false } });

  const currentIsraelDate = isoDateInTimezone(new Date());
  const endDate = args.endDate ?? shiftDate(currentIsraelDate, -1);
  validateDate(endDate, "--end-date");
  const startDate = shiftDate(endDate, -6);
  const queryStart = `${shiftDate(startDate, -50)}T00:00:00Z`;
  const queryEnd = `${shiftDate(endDate, 2)}T00:00:00Z`;

  let seasonName = args.seasonName;
  if (!seasonName) {
    const { data: competitions, error: competitionError } = await client.from("api_competitions").select("competition_id,scope");
    if (competitionError) throw competitionError;
    const foreignIds = competitions.filter((item) => item.scope === "foreign_club").map((item) => item.competition_id);
    const { data: seasons, error: seasonError } = await client
      .from("api_seasons")
      .select("season_name,latest_match_at,player_count,completed_match_count")
      .in("competition_id", foreignIds)
      .limit(5000);
    if (seasonError) throw seasonError;
    const grouped = new Map();
    for (const season of seasons) {
      const current = grouped.get(season.season_name) ?? { dataRows: 0, latest: 0 };
      current.dataRows += Number(season.player_count ?? 0) + Number(season.completed_match_count ?? 0);
      current.latest = Math.max(current.latest, Date.parse(season.latest_match_at ?? "") || 0);
      grouped.set(season.season_name, current);
    }
    seasonName = [...grouped.entries()]
      .filter(([, value]) => value.dataRows > 0)
      .sort((left, right) => right[1].latest - left[1].latest || right[0].localeCompare(left[0]))[0]?.[0];
  }
  if (!seasonName) throw new Error("Could not resolve the active legionnaire season.");

  let censusResult = await client.rpc("api_legionnaires", { p_season_name: seasonName });
  if (censusResult.error) censusResult = await client.rpc("api_legionnaires", { p_season_name: seasonName });
  if (censusResult.error) throw censusResult.error;
  const census = censusResult.data;
  const activeCensus = census.filter((player) => Number(player.appearances) > 0);
  const playerIds = activeCensus.map((player) => player.player_id);
  const playerNameById = new Map(census.map((player) => [player.player_id, player.display_name_he || player.display_name]));
  const censusByPlayerId = new Map(census.map((player) => [player.player_id, player]));

  const historyRows = await selectAll((from, to) => client
    .from("api_player_history")
    .select("player_id,display_name,appearance_id,match_id,scheduled_at,team_name,opponent_team_name,side,minutes_played,home_score,away_score,metric_code,value_numeric")
    .in("player_id", playerIds)
    .gte("scheduled_at", queryStart)
    .lt("scheduled_at", queryEnd)
    .order("scheduled_at")
    .range(from, to));

  const appearanceIds = [...new Set(historyRows.map((row) => row.appearance_id))];
  const lineupRows = appearanceIds.length ? await selectAll((from, to) => client
    .from("api_match_player_stats")
    .select("appearance_id,lineup_status")
    .in("appearance_id", appearanceIds)
    .range(from, to)) : [];
  const lineupByAppearanceId = new Map(lineupRows.map((row) => [row.appearance_id, row.lineup_status]));
  const grouped = groupAppearances(historyRows, playerNameById, lineupByAppearanceId);
  const weekly = grouped.appearances.filter((match) => {
    const localDate = isoDateInTimezone(new Date(match.scheduledAt));
    return localDate >= startDate && localDate <= endDate && match.minutes > 0;
  });
  const players = [...new Set(weekly.map((match) => match.playerId))].map((playerId) => {
    const playerMatches = weekly.filter((match) => match.playerId === playerId).sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
    const priorMatches = grouped.appearances
      .filter((match) => match.playerId === playerId && isoDateInTimezone(new Date(match.scheduledAt)) < startDate && match.minutes >= 30)
      .sort((left, right) => right.scheduledAt.localeCompare(left.scheduledAt))
      .slice(0, baselineMatchLimit);
    const weekAggregate = aggregateMatches(playerMatches);
    const baselineAggregate = aggregateMatches(priorMatches);
    const censusPlayer = censusByPlayerId.get(playerId);
    return {
      playerId,
      nameHe: playerNameById.get(playerId),
      teamName: playerMatches.at(-1)?.teamName ?? censusPlayer?.team_name ?? "",
      competitionNameHe: censusPlayer?.competition_name_he || censusPlayer?.competition_name || "",
      position: censusPlayer?.specific_position || censusPlayer?.primary_position || null,
      appearances: playerMatches.length,
      starts: playerMatches.filter((match) => match.started).length,
      minutes: weekAggregate.minutes,
      metrics: roundedRecord(weekAggregate.totals),
      per90: roundedRecord(weekAggregate.per90),
      baseline: {
        matchCount: priorMatches.length,
        minutes: baselineAggregate.minutes,
        per90: roundedRecord(baselineAggregate.per90),
      },
      matches: playerMatches.map((match) => ({
        matchId: match.matchId,
        scheduledAt: match.scheduledAt,
        teamName: match.teamName,
        opponentName: match.opponentName,
        minutes: match.minutes,
        started: match.started,
        scoreFor: match.scoreFor,
        scoreAgainst: match.scoreAgainst,
        metrics: roundedRecord(match.metrics),
        dataCompleteness: Object.keys(match.metrics).length >= fullStatThreshold ? "full" : "basic",
      })),
    };
  }).sort((left, right) => {
    const leftRating = Number(left.metrics.rating_365);
    const rightRating = Number(right.metrics.rating_365);
    const leftHasRating = Number.isFinite(leftRating);
    const rightHasRating = Number.isFinite(rightRating);
    if (leftHasRating !== rightHasRating) return rightHasRating ? 1 : -1;
    if (leftHasRating && rightHasRating && rightRating !== leftRating) return rightRating - leftRating;
    return right.minutes - left.minutes || left.nameHe.localeCompare(right.nameHe, "he");
  });

  const appearances = players.reduce((sum, player) => sum + player.appearances, 0);
  const starts = players.reduce((sum, player) => sum + player.starts, 0);
  const minutes = players.reduce((sum, player) => sum + player.minutes, 0);
  const fullStatAppearances = players.flatMap((player) => player.matches).filter((match) => match.dataCompleteness === "full").length;
  const basicOnlyAppearances = appearances - fullStatAppearances;
  const summary = {
    eligiblePlayers: census.length,
    playersWithMinutes: players.length,
    appearances,
    starts,
    minutes,
    fullStatAppearances,
    basicOnlyAppearances,
    players,
  };
  const evidence = [
    {
      id: "week.summary",
      label: "היקף פעילות הלגיונרים השבועי",
      sourceView: "api_legionnaires + api_player_history",
      sourceRows: historyRows.length,
      values: [census.length, players.length, appearances, starts, minutes, fullStatAppearances, basicOnlyAppearances],
      context: { startDate, endDate, duplicateMatchIdsRemoved: grouped.duplicateMatchIdsRemoved },
    },
    ...players.map((player) => ({
      id: `player.week.${player.playerId}`,
      label: `${player.nameHe} - השבוע והבסיס להשוואה`,
      sourceView: "api_player_history",
      sourceRows: player.matches.length,
      values: [
        player.appearances,
        player.starts,
        player.minutes,
        ...Object.values(player.metrics),
        ...Object.values(player.per90),
        player.baseline.matchCount,
        player.baseline.minutes,
        ...Object.values(player.baseline.per90),
        ...player.matches.flatMap((match) => [match.minutes, match.scoreFor, match.scoreAgainst, ...Object.values(match.metrics)]).filter(Number.isFinite),
      ],
      context: player,
    })),
  ];
  const slug = `legionnaires-weekly-${startDate}-to-${endDate}`;
  const workbenchDirectory = path.join(workbenchRoot, slug);
  const source = {
    schemaVersion: 1,
    slug,
    language: "he",
    kind: "legionnaire_weekly",
    generatedAt: new Date().toISOString(),
    period: { start: startDate, end: endDate, labelHe: `${startDate.split("-").reverse().join(".")} - ${endDate.split("-").reverse().join(".")}`, seasonName },
    summary,
    evidence,
    insightCandidates: insightCandidates(players),
    dataAudit: {
      queriedHistoryRows: historyRows.length,
      duplicateMatchIdsRemoved: grouped.duplicateMatchIdsRemoved,
      fullStatAppearances,
      basicOnlyAppearances,
    },
  };
  const authoredTemplate = {
    schemaVersion: 2,
    model: null,
    authorship: { analystAgentId: "", writerAgentId: "", editorAgentId: "", reviewerAgentId: "" },
    analysisPlan: {
      thesis: { claimHe: "", whyItMattersHe: "", evidenceIds: [] },
      rankedInsights: [],
      explanatoryModel: { questionHe: "", answerHe: "", supportLevel: "descriptive", evidenceIds: [], components: [] },
      historicalAudit: { decision: "omit", teamSignalsReviewed: true, playerSignalsReviewed: true, findingHe: "", evidenceIds: [] },
      narrativeArc: [],
      graphics: [],
      coverageDecisions: [],
      quality: {
        singleThesis: false,
        explainsRatherThanLists: false,
        readerValue: false,
        gameStateAdjusted: true,
        selectiveEvidence: false,
        graphicsServeStory: false,
        explanatoryDepth: false,
        playerRoleAttribution: false,
        historicalAuditComplete: false,
      },
    },
    draftEditorial: null,
    draftPlayerRecaps: [],
    playerRecaps: [],
    editorial: null,
    editorialReview: null,
    qualityReview: null,
  };
  await mkdir(workbenchDirectory, { recursive: true });
  await writeFile(path.join(workbenchDirectory, "source.json"), `${JSON.stringify(source, null, 2)}\n`, "utf8");
  await writeFile(path.join(workbenchDirectory, "authored.template.json"), `${JSON.stringify(authoredTemplate, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ slug, workbenchDirectory, period: source.period, summary: { ...summary, players: undefined }, topCandidates: source.insightCandidates.slice(0, 8) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
