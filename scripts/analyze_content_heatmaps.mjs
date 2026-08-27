import sharp from "sharp";

const HEATMAP_WIDTH = 540;
const HEATMAP_HEIGHT = 341;
const HEATMAP_IMAGE_PROXY = "https://imagecache.365scores.com/image/fetch/w_1080,q_auto:eco,f_webp/";

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function blankPitchUrl(direction) {
  const source = `https://heatmap.365scores.com/?compressed_data=&dir=${direction}`;
  return `${HEATMAP_IMAGE_PROXY}${encodeURIComponent(source)}`;
}

function isRtlHeatmap(url) {
  try {
    return decodeURIComponent(url).toLowerCase().includes("dir=rtl");
  } catch {
    return url.toLowerCase().includes("dir%3drtl") || url.toLowerCase().includes("dir=rtl");
  }
}

async function imagePixels(url, flipHorizontally = false) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Heatmap image request failed (${response.status})`);
  let image = sharp(Buffer.from(await response.arrayBuffer())).resize({
    width: HEATMAP_WIDTH,
    height: HEATMAP_HEIGHT,
    fit: "fill",
  });
  if (flipHorizontally) image = image.flop();
  return image.ensureAlpha().raw().toBuffer();
}

function densityCentroid(image, baseline) {
  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let pixel = 0, offset = 0; pixel < HEATMAP_WIDTH * HEATMAP_HEIGHT; pixel += 1, offset += 4) {
    if (baseline[offset + 3] === 0) continue;
    const isPitchMarking = baseline[offset] > 175
      && baseline[offset + 1] > 175
      && baseline[offset + 2] > 175;
    if (isPitchMarking) continue;
    const dr = image[offset] - baseline[offset];
    const dg = image[offset + 1] - baseline[offset + 1];
    const db = image[offset + 2] - baseline[offset + 2];
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance < 14) continue;
    const weight = Math.min(1.5, (distance - 8) / 150);
    const x = pixel % HEATMAP_WIDTH;
    const y = Math.floor(pixel / HEATMAP_WIDTH);
    totalWeight += weight;
    weightedX += x * weight;
    weightedY += y * weight;
  }

  if (totalWeight < 1) return null;
  return {
    x: round(Math.max(0, Math.min(100, weightedX / totalWeight * 100 / (HEATMAP_WIDTH - 1)))),
    y: round(Math.max(0, Math.min(100, 100 - weightedY / totalWeight * 100 / (HEATMAP_HEIGHT - 1)))),
  };
}

async function mapWithConcurrency(items, concurrency, work) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await work(items[index]);
      } catch {
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results.filter(Boolean);
}

function teamProfile(teamPlayers) {
  const outfield = teamPlayers.filter((player) => player.roleGroup !== "Goalkeeper");
  const sortedWidth = outfield.map((player) => player.y).sort((left, right) => left - right);
  const average = (values) => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const roleDepth = (role) => average(outfield.filter((player) => player.roleGroup === role).map((player) => player.x));
  return {
    sampleSize: outfield.length,
    defenderCount: outfield.filter((player) => player.roleGroup === "Defender").length,
    midfielderCount: outfield.filter((player) => player.roleGroup === "Midfielder").length,
    attackerCount: outfield.filter((player) => player.roleGroup === "Attacker").length,
    centralLanePlayers: outfield.filter((player) => player.y >= 40 && player.y <= 60).length,
    halfSpacePlayers: outfield.filter((player) => (player.y >= 24 && player.y < 40) || (player.y > 60 && player.y <= 76)).length,
    wideLanePlayers: outfield.filter((player) => player.y < 24 || player.y > 76).length,
    leftLanePlayers: outfield.filter((player) => player.y > 66).length,
    rightLanePlayers: outfield.filter((player) => player.y < 34).length,
    averageDepth: average(outfield.map((player) => player.x)),
    width: sortedWidth.length > 1 ? round(sortedWidth[sortedWidth.length - 1] - sortedWidth[0]) : 0,
    playersInAttackingHalf: outfield.filter((player) => player.x >= 50).length,
    playersInFinalThird: outfield.filter((player) => player.x >= 66.7).length,
    defenderDepth: roleDepth("Defender"),
    midfielderDepth: roleDepth("Midfielder"),
    attackerDepth: roleDepth("Attacker"),
    players: teamPlayers.map((player) => ({
      playerId: player.playerId,
      nameHe: player.nameHe,
      roleGroup: player.roleGroup,
      formationPosition: player.formationPosition,
      x: player.x,
      y: player.y,
    })),
  };
}

export async function analyzeContentHeatmaps(rows, players, homeTeamId, awayTeamId) {
  if (!rows.length) return null;
  const [baselineLtr, baselineRtl] = await Promise.all([
    imagePixels(blankPitchUrl("ltr")),
    imagePixels(blankPitchUrl("rtl"), true),
  ]);
  const playerById = new Map(players.map((player) => [player.playerId, player]));
  const positions = await mapWithConcurrency(rows, 6, async (row) => {
    const isRtl = isRtlHeatmap(row.heatmap_url);
    const image = await imagePixels(row.heatmap_url, isRtl);
    const centroid = densityCentroid(image, isRtl ? baselineRtl : baselineLtr);
    const player = playerById.get(row.player_id);
    return centroid && player ? { ...player, ...centroid } : null;
  });
  const starters = positions.filter((player) => /start/i.test(player.lineupStatus ?? ""));
  return {
    method: "full_appearance_density_centroid",
    timed: false,
    starterHeatmaps: starters.length,
    home: teamProfile(starters.filter((player) => player.teamId === homeTeamId)),
    away: teamProfile(starters.filter((player) => player.teamId === awayTeamId)),
    positions: positions.map((player) => ({
      playerId: player.playerId,
      teamId: player.teamId,
      lineupStatus: player.lineupStatus,
      roleGroup: player.roleGroup,
      formationPosition: player.formationPosition,
      x: player.x,
      y: player.y,
    })),
  };
}
