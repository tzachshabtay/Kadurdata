import { createHash } from "node:crypto";

export const PLAYER_COMPARISON_METRICS = {
  key_passes: { labelHe: "מסירות מפתח", family: "attack" },
  total_shots: { labelHe: "בעיטות", family: "attack" },
  passes_into_final_third: { labelHe: "מסירות לשליש האחרון", family: "attack" },
  ball_recovery: { labelHe: "חילוצי כדור", family: "defense" },
  clearances: { labelHe: "הרחקות כדור", family: "defense" },
  fouls_made: { labelHe: "עבירות שביצע", family: "defense" },
  interceptions: { labelHe: "חטיפות", family: "defense" },
  was_dribbled_past: { labelHe: "עברו אותו בכדרור", family: "defense", lowerIsBetter: true },
};
const defenseCodes = Object.keys(PLAYER_COMPARISON_METRICS).filter(code => PLAYER_COMPARISON_METRICS[code].family === "defense");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const round = (value, digits) => Number(value.toFixed(digits));
export const playerInputHash = input => createHash("sha256").update(JSON.stringify(input)).digest("hex");

// A separate supplement preserves the previously sealed attacking snapshot.
export function preparePlayerComparisonInput(source, raw, names, minimumMinutes = 180) {
  assert(raw.snapshotHash === source.snapshotHash, "Player supplement belongs to another snapshot.");
  const rows = raw.players.filter(r => defenseCodes.includes(r.metric_code)).map(r => ({
    appearanceId: r.appearance_id, playerId: r.player_id, matchId: r.match_id,
    teamId: r.team_id, position: r.formation_position, minutes: r.minutes_played,
    sourceCode: r.source_code, code: r.metric_code, value: r.value_numeric,
  }));
  return { role: "Left Back", minimumMinutes, queriedAt: raw.queriedAt, names, rows };
}

export function derivePlayerComparison(snapshot, input) {
  assert(input?.role === "Left Back" && Number.isInteger(input.minimumMinutes) && input.minimumMinutes > 0, "Invalid player comparison role or minimum minutes.");
  assert(Number.isFinite(Date.parse(input.queriedAt)) && Array.isArray(input.rows), "Missing player supplement provenance.");
  const apps = snapshot.appearances.filter(a => a.position === input.role);
  const byId = new Map(apps.map(a => [a.appearanceId, a]));
  const supplemental = new Map();
  for (const row of input.rows) {
    const app = byId.get(row.appearanceId);
    assert(app && ["playerId", "matchId", "teamId", "position", "minutes"].every(k => app[k] === row[k]), "Supplement appearance differs from the sealed role/window/minutes.");
    assert(row.sourceCode === "365scores" && defenseCodes.includes(row.code) && Number.isFinite(row.value) && row.value >= 0, "Invalid defensive metric source/value.");
    const key = `${row.appearanceId}:${row.code}`;
    assert(!supplemental.has(key), "Duplicate defensive metric.");
    supplemental.set(key, row.value);
  }
  const ids = [...new Set(apps.map(a => a.playerId))].sort();
  assert(Object.keys(input.names ?? {}).length === ids.length && ids.every(id => typeof input.names[id] === "string" && input.names[id].trim()), "Provide verified names for every left-back.");
  const complete = apps.map(app => {
    for (const code of defenseCodes) assert(supplemental.has(`${app.appearanceId}:${code}`), `Missing defensive metric: ${app.appearanceId}:${code}.`);
    return { ...app, metrics: { ...app.metrics, ...Object.fromEntries(defenseCodes.map(code => [code, supplemental.get(`${app.appearanceId}:${code}`)])) } };
  });
  const summarize = rows => {
    const minutes = rows.reduce((s, r) => s + r.minutes, 0);
    return { minutes, appearances: rows.length, metrics: Object.fromEntries(Object.keys(PLAYER_COMPARISON_METRICS).map(code => {
      const total = rows.reduce((s, r) => s + r.metrics[code], 0);
      return [code, { total, per90: minutes ? round(total * 90 / minutes, 2) : null, per90OneDecimal: minutes ? round(total * 90 / minutes, 1) : null }];
    })) };
  };
  const players = ids.map(playerId => {
    const rows = complete.filter(a => a.playerId === playerId);
    const data = summarize(rows);
    return { playerId, nameHe: input.names[playerId], teamIds: [...new Set(rows.map(a => a.teamId))], ...data, eligible: data.minutes >= input.minimumMinutes, byMatch: rows };
  });
  const eligible = players.filter(p => p.eligible);
  assert(eligible.length >= 2, "Player comparison needs at least two eligible peers.");
  const eligibleIds = new Set(eligible.map(p => p.playerId));
  const rests = eligible.map(p => ({ playerId: p.playerId, players: eligible.length - 1, ...summarize(complete.filter(a => eligibleIds.has(a.playerId) && a.playerId !== p.playerId)) }));
  const scope = { role: input.role, minimumMinutes: input.minimumMinutes, players: players.length, eligiblePlayers: eligible.length };
  const values = p => [90, p.minutes, p.appearances, ...Object.values(p.metrics).flatMap(m => [m.total, m.per90, m.per90OneDecimal]).filter(v => v !== null)];
  const evidence = [
    { id: "peer.scope", label: "השוואת מגנים שמאליים", sourceView: "api_match_player_stats", sourceRows: input.rows.length, values: [90, scope.minimumMinutes, scope.players, scope.eligiblePlayers], context: scope },
    ...players.map(p => ({ id: `peer.${p.playerId}`, label: p.nameHe, sourceView: "api_match_player_stats", sourceRows: p.appearances * Object.keys(PLAYER_COMPARISON_METRICS).length, values: [...values(p), ...p.byMatch.flatMap(a => [a.minutes, ...Object.values(a.metrics)])], context: p })),
    ...rests.map(p => ({ id: `peer.rest.${p.playerId}`, label: `יתר המגנים בהשוואה ללא ${input.names[p.playerId]}`, sourceView: "api_match_player_stats", sourceRows: p.appearances * Object.keys(PLAYER_COMPARISON_METRICS).length, values: [p.players, ...values(p)], context: p })),
  ];
  return { comparison: { input, inputHash: playerInputHash(input), scope, metricDefinitions: PLAYER_COMPARISON_METRICS, players, rests }, evidence };
}
