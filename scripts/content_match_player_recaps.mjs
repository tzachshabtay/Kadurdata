// Match recap evidence is derived from the immutable player snapshot, never
// from author-supplied ratings or statistics.
export function matchPlayerRecapEvidence(players) {
  return players.filter((player) => player.minutes > 0).map((player) => ({
    id: `player.match.${player.playerId}`,
    label: `נתוני המשחק של ${player.nameHe}`,
    sourceView: "api_match_player_stats",
    sourceRows: Object.keys(player.metrics).length,
    values: [...new Set([player.minutes, ...Object.values(player.metrics)].filter(Number.isFinite))],
    context: {
      playerId: player.playerId,
      teamId: player.teamId,
      nameHe: player.nameHe,
      minutes: player.minutes,
      metrics: player.metrics,
    },
  }));
}

export function validateMatchPlayerRecaps(players, recaps) {
  if (recaps === undefined) return [];
  if (!Array.isArray(recaps)) return ["Player recaps must be an array."];
  const played = new Map(players.filter((player) => player.minutes > 0).map((player) => [player.playerId, player]));
  const failures = [];
  const seen = new Set();
  for (const recap of recaps) {
    const player = played.get(recap.playerId);
    if (!player || seen.has(recap.playerId)) {
      failures.push(`Unknown, unused or duplicate recap player: ${recap.playerId}`);
      continue;
    }
    seen.add(recap.playerId);
    if (typeof recap.nameHe !== "string" || !/[\u0590-\u05FF]/u.test(recap.nameHe)) failures.push(`Missing Hebrew display name: ${player.nameHe}`);
    if (typeof recap.text !== "string" || !recap.text.trim() || !/[\u0590-\u05FF]/u.test(recap.text)) failures.push(`Missing Hebrew recap: ${player.nameHe}`);
    if (!Array.isArray(recap.statCodes) || recap.statCodes.length < 1 || recap.statCodes.length > 3
      || recap.statCodes.some((code) => !Number.isFinite(player.metrics[code]))) {
      failures.push(`Recap statistics are unavailable: ${player.nameHe}`);
    }
    if (!Array.isArray(recap.evidenceIds) || !recap.evidenceIds.includes(`player.match.${player.playerId}`)) {
      failures.push(`Recap must cite its own player's match evidence: ${player.nameHe}`);
    }
    // A number appearing elsewhere in the match must not validate this player's claim.
    const allowed = [player.minutes, ...Object.values(player.metrics)].filter(Number.isFinite);
    for (const match of String(recap.text ?? "").matchAll(/\d+(?:[.,]\d+)?/g)) {
      const value = Number(match[0].replace(",", "."));
      if (!allowed.some((number) => Math.abs(number - value) < 0.005)) failures.push(`Unsupported recap number ${value}: ${player.nameHe}`);
    }
  }
  for (const [id, player] of played) if (!seen.has(id)) failures.push(`Missing played player: ${player.nameHe}`);
  return failures;
}
