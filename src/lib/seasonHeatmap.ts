import type { MatchPlayerHeatmap, PlayerSeasonHeatmap } from "./types";

const HEATMAP_WIDTH = 540;
const HEATMAP_HEIGHT = 341;
const HEATMAP_IMAGE_PROXY = "https://imagecache.365scores.com/image/fetch/w_1080,q_auto:eco,f_webp/";

type LoadedHeatmap = {
  row: PlayerSeasonHeatmap;
  image: HTMLImageElement;
  isRtl: boolean;
};

export type SeasonHeatmapRenderResult = {
  matchCount: number;
  sourceImageCount: number;
};

export type MatchAveragePosition = {
  playerId: string;
  x: number;
  y: number;
};

function blankPitchUrl(direction: "ltr" | "rtl") {
  const source = `https://heatmap.365scores.com/?compressed_data=&dir=${direction}`;
  return `${HEATMAP_IMAGE_PROXY}${encodeURIComponent(source)}`;
}

function isRtlHeatmap(url: string) {
  try {
    return decodeURIComponent(url).toLowerCase().includes("dir=rtl");
  } catch {
    return url.toLowerCase().includes("dir%3drtl") || url.toLowerCase().includes("dir=rtl");
  }
}

function loadImage(url: string, signal?: AbortSignal) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const image = new Image();
    const abort = () => {
      image.src = "";
      reject(new DOMException("Aborted", "AbortError"));
    };
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      signal?.removeEventListener("abort", abort);
      resolve(image);
    };
    image.onerror = () => {
      signal?.removeEventListener("abort", abort);
      reject(new Error(`Could not load heatmap image: ${url}`));
    };
    signal?.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}

function drawNormalized(context: CanvasRenderingContext2D, image: CanvasImageSource, isRtl: boolean) {
  context.clearRect(0, 0, HEATMAP_WIDTH, HEATMAP_HEIGHT);
  context.save();
  if (isRtl) {
    context.translate(HEATMAP_WIDTH, 0);
    context.scale(-1, 1);
  }
  context.drawImage(image, 0, 0, HEATMAP_WIDTH, HEATMAP_HEIGHT);
  context.restore();
  return context.getImageData(0, 0, HEATMAP_WIDTH, HEATMAP_HEIGHT);
}

function densityCentroid(imageData: ImageData, baseline: ImageData) {
  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let pixel = 0, offset = 0; pixel < HEATMAP_WIDTH * HEATMAP_HEIGHT; pixel += 1, offset += 4) {
    if (baseline.data[offset + 3] === 0) continue;
    const isPitchMarking = baseline.data[offset] > 175
      && baseline.data[offset + 1] > 175
      && baseline.data[offset + 2] > 175;
    if (isPitchMarking) continue;
    const dr = imageData.data[offset] - baseline.data[offset];
    const dg = imageData.data[offset + 1] - baseline.data[offset + 1];
    const db = imageData.data[offset + 2] - baseline.data[offset + 2];
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
    x: weightedX / totalWeight,
    y: weightedY / totalWeight,
  };
}

export async function calculateMatchAveragePositions(
  rows: MatchPlayerHeatmap[],
  signal?: AbortSignal,
): Promise<MatchAveragePosition[]> {
  if (!rows.length) return [];
  const [blankLtr, blankRtl, loadedResults] = await Promise.all([
    loadImage(blankPitchUrl("ltr"), signal),
    loadImage(blankPitchUrl("rtl"), signal),
    Promise.allSettled(rows.map(async (row) => ({
      row,
      image: await loadImage(row.heatmap_url, signal),
      isRtl: isRtlHeatmap(row.heatmap_url),
    }))),
  ]);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const workingCanvas = document.createElement("canvas");
  workingCanvas.width = HEATMAP_WIDTH;
  workingCanvas.height = HEATMAP_HEIGHT;
  const workingContext = workingCanvas.getContext("2d", { willReadFrequently: true });
  if (!workingContext) throw new Error("Canvas is not available");

  const baselineLtr = drawNormalized(workingContext, blankLtr, false);
  const baselineRtl = drawNormalized(workingContext, blankRtl, true);
  const byPlayer = new Map<string, Array<{ x: number; y: number }>>();
  loadedResults.forEach((result) => {
    if (result.status !== "fulfilled") return;
    const { row, image, isRtl } = result.value;
    const imageData = drawNormalized(workingContext, image, isRtl);
    const centroid = densityCentroid(imageData, isRtl ? baselineRtl : baselineLtr);
    if (!centroid) return;
    byPlayer.set(row.player_id, [...(byPlayer.get(row.player_id) ?? []), centroid]);
  });

  return Array.from(byPlayer.entries()).map(([playerId, positions]) => {
    const averageX = positions.reduce((total, position) => total + position.x, 0) / positions.length;
    const averageY = positions.reduce((total, position) => total + position.y, 0) / positions.length;
    return {
      playerId,
      x: Math.max(6, Math.min(94, averageX * 100 / (HEATMAP_WIDTH - 1))),
      y: Math.max(8, Math.min(92, averageY * 100 / (HEATMAP_HEIGHT - 1))),
    };
  });
}

function heatColor(value: number): [number, number, number] {
  const stops: Array<[number, number, number, number]> = [
    [0, 38, 190, 116],
    [0.28, 103, 211, 73],
    [0.52, 232, 222, 67],
    [0.75, 248, 155, 54],
    [1, 232, 67, 62],
  ];
  const upperIndex = Math.max(1, stops.findIndex((stop) => value <= stop[0]));
  const lower = stops[upperIndex - 1];
  const upper = stops[upperIndex] ?? stops[stops.length - 1];
  const distance = upper[0] - lower[0] || 1;
  const ratio = Math.max(0, Math.min(1, (value - lower[0]) / distance));
  return [
    Math.round(lower[1] + (upper[1] - lower[1]) * ratio),
    Math.round(lower[2] + (upper[2] - lower[2]) * ratio),
    Math.round(lower[3] + (upper[3] - lower[3]) * ratio),
  ];
}

export async function renderSeasonHeatmap(
  canvas: HTMLCanvasElement,
  rows: PlayerSeasonHeatmap[],
  signal?: AbortSignal,
): Promise<SeasonHeatmapRenderResult> {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is not available");
  canvas.width = HEATMAP_WIDTH;
  canvas.height = HEATMAP_HEIGHT;

  const [blankLtr, blankRtl, loadedResults] = await Promise.all([
    loadImage(blankPitchUrl("ltr"), signal),
    loadImage(blankPitchUrl("rtl"), signal),
    Promise.allSettled(rows.map(async (row): Promise<LoadedHeatmap> => ({
      row,
      image: await loadImage(row.heatmap_url, signal),
      isRtl: isRtlHeatmap(row.heatmap_url),
    }))),
  ]);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const workingCanvas = document.createElement("canvas");
  workingCanvas.width = HEATMAP_WIDTH;
  workingCanvas.height = HEATMAP_HEIGHT;
  const workingContext = workingCanvas.getContext("2d", { willReadFrequently: true });
  if (!workingContext) throw new Error("Canvas is not available");

  const baselineLtr = drawNormalized(workingContext, blankLtr, false);
  const baselineRtl = drawNormalized(workingContext, blankRtl, true);
  const loaded = loadedResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const byMatch = new Map<string, LoadedHeatmap[]>();
  loaded.forEach((item) => byMatch.set(item.row.match_id, [...(byMatch.get(item.row.match_id) ?? []), item]));

  // Average sources within a match, then add matches so duplicate providers do not carry extra weight.
  const pixelCount = HEATMAP_WIDTH * HEATMAP_HEIGHT;
  const density = new Float32Array(pixelCount);
  byMatch.forEach((matchImages) => {
    const matchDensity = new Float32Array(pixelCount);
    matchImages.forEach((item) => {
      const imageData = drawNormalized(workingContext, item.image, item.isRtl);
      const baseline = item.isRtl ? baselineRtl : baselineLtr;
      for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
        if (baseline.data[offset + 3] === 0) continue;
        const dr = imageData.data[offset] - baseline.data[offset];
        const dg = imageData.data[offset + 1] - baseline.data[offset + 1];
        const db = imageData.data[offset + 2] - baseline.data[offset + 2];
        const distance = Math.sqrt(dr * dr + dg * dg + db * db);
        if (distance < 14) continue;
        matchDensity[pixel] += Math.min(1.5, (distance - 8) / 150);
      }
    });
    const sourceWeight = 1 / matchImages.length;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      density[pixel] += matchDensity[pixel] * sourceWeight;
    }
  });

  const positiveDensity = Array.from(density).filter((value) => value > 0.025).sort((a, b) => a - b);
  const reference = positiveDensity.length
    ? positiveDensity[Math.floor((positiveDensity.length - 1) * 0.985)]
    : 1;
  const output = new ImageData(new Uint8ClampedArray(baselineLtr.data), HEATMAP_WIDTH, HEATMAP_HEIGHT);
  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
    const normalized = Math.max(0, Math.min(1, density[pixel] / reference));
    if (normalized < 0.025) continue;
    const isPitchMarking = baselineLtr.data[offset] > 175
      && baselineLtr.data[offset + 1] > 175
      && baselineLtr.data[offset + 2] > 175;
    if (isPitchMarking) continue;
    const [red, green, blue] = heatColor(normalized);
    const alpha = Math.min(0.9, 0.08 + Math.pow(normalized, 0.68) * 0.82);
    output.data[offset] = Math.round(output.data[offset] * (1 - alpha) + red * alpha);
    output.data[offset + 1] = Math.round(output.data[offset + 1] * (1 - alpha) + green * alpha);
    output.data[offset + 2] = Math.round(output.data[offset + 2] * (1 - alpha) + blue * alpha);
  }
  context.putImageData(output, 0, 0);

  return { matchCount: byMatch.size, sourceImageCount: loaded.length };
}
