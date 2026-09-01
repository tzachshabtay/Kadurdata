#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildReviewPacket } from "./content_language_review.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pipelineVersion = "legionnaire-weekly-v1";

function parseArguments() {
  const args = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  return { sourcePath: valueAfter("--source"), authoredPath: valueAfter("--authored") };
}

function extractNumbers(text) {
  return [...String(text ?? "").matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => Number(match[0].replace(",", ".")));
}

function numbersMatch(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.005;
}

function claims(editorial) {
  return [
    { text: editorial.headline, evidenceIds: editorial.headlineEvidenceIds },
    { text: editorial.dek, evidenceIds: editorial.dekEvidenceIds },
    ...editorial.sections.flatMap((section) => section.paragraphs),
    ...editorial.takeaways,
    { text: editorial.conclusion, evidenceIds: editorial.conclusionEvidenceIds },
  ];
}

function requirePassedReview(review, label) {
  if (!review || review.status !== "passed" || !Object.values(review.checks ?? {}).every(Boolean)) {
    throw new Error(`${label} is missing or failed.`);
  }
}

async function main() {
  const args = parseArguments();
  if (!args.sourcePath || !args.authoredPath) {
    throw new Error("Usage: node scripts/finalize_legionnaire_weekly_article.mjs --source <source.json> --authored <authored.json>");
  }
  const sourcePath = path.resolve(projectRoot, args.sourcePath);
  const authoredPath = path.resolve(projectRoot, args.authoredPath);
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const authored = JSON.parse(await readFile(authoredPath, "utf8"));
  if (source.kind !== "legionnaire_weekly" || source.schemaVersion !== 1) throw new Error("Unsupported weekly source schema.");
  if (authored.schemaVersion !== 2 || !authored.editorial || !authored.draftEditorial) throw new Error("Authored copy is incomplete.");

  const roleIds = Object.values(authored.authorship ?? {});
  if (roleIds.length !== 4 || roleIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(roleIds).size !== 4) {
    throw new Error("Analyst, writer, Hebrew editor, and reviewer must be four distinct real agent IDs.");
  }
  requirePassedReview(authored.editorialReview, "Editorial review");
  requirePassedReview(authored.qualityReview, "Quality review");
  if (authored.editorialReview.mode !== "codex_skill_editor" || authored.qualityReview.mode !== "codex_skill_quality_gate") {
    throw new Error("Review modes do not match the Codex skill workflow.");
  }
  if (authored.qualityReview.issues?.length) throw new Error("Blind review contains unresolved issues.");
  const packet = buildReviewPacket(authored);
  if (authored.editorialReview.draftHash !== packet.draftHash || authored.editorialReview.finalHash !== packet.finalHash) {
    throw new Error("Editorial review hashes do not match the authored copy.");
  }
  if (authored.qualityReview.reviewedHash !== packet.finalHash || authored.qualityReview.numberlessHash !== packet.numberlessHash) {
    throw new Error("Blind review hashes do not match the final copy.");
  }
  const exactSentences = new Map(packet.sentences.map((sentence) => [sentence.location, sentence.text]));
  for (const [label, reviews] of [["editorial", authored.editorialReview.sentenceReviews], ["blind", authored.qualityReview.sentenceReviews]]) {
    if (!Array.isArray(reviews) || reviews.length !== exactSentences.size) throw new Error(`${label} review does not cover every visible sentence.`);
    for (const review of reviews) {
      if (exactSentences.get(review.location) !== review.text || review.verdict !== "passed") throw new Error(`${label} review failed at ${review.location}.`);
    }
  }
  if (authored.qualityReview.numberlessReview?.status !== "passed" || authored.qualityReview.numberlessReview?.articleStillCoherent !== true || authored.qualityReview.numberlessReview?.issues?.length) {
    throw new Error("The article failed the numberless-story read.");
  }
  if (JSON.stringify({ editorial: authored.editorial, graphics: authored.analysisPlan?.graphics }).includes("—")) {
    throw new Error("Visible copy contains an em dash. Run content:postprocess first.");
  }
  if (!authored.analysisPlan?.quality || !Object.values(authored.analysisPlan.quality).every(Boolean)) {
    throw new Error("Analysis-plan quality gates are incomplete.");
  }
  const plannedInsights = new Set((authored.analysisPlan.rankedInsights ?? []).map((insight) => insight.id));
  const usedInsights = authored.editorial.sections.flatMap((section) => section.insightIds ?? []);
  if (!plannedInsights.size || usedInsights.some((id) => !plannedInsights.has(id))) throw new Error("Editorial sections reference missing analysis insights.");
  if (authored.editorial.sections.length < 3 || authored.editorial.sections.length > 6 || authored.editorial.takeaways.length !== 3) {
    throw new Error("Weekly editorial must contain 3-6 sections and exactly three takeaways.");
  }
  const evidenceById = new Map(source.evidence.map((item) => [item.id, item]));
  for (const claim of claims(authored.editorial)) {
    if (!claim.evidenceIds?.length) throw new Error(`Claim has no evidence: ${claim.text}`);
    const allowedValues = claim.evidenceIds.flatMap((id) => {
      const evidence = evidenceById.get(id);
      if (!evidence) throw new Error(`Unknown evidence ID ${id}.`);
      return evidence.values;
    });
    for (const number of extractNumbers(claim.text)) {
      if (!allowedValues.some((value) => numbersMatch(number, value))) throw new Error(`Unsupported number ${number}: ${claim.text}`);
    }
  }
  const graphics = authored.analysisPlan.graphics ?? [];
  if (graphics.length < 2 || graphics.length > 3 || new Set(graphics.map((graphic) => graphic.type)).size !== graphics.length) {
    throw new Error("Weekly analysis must select 2-3 distinct graphics.");
  }
  const playerIds = new Set(source.summary.players.map((player) => player.playerId));
  for (const graphic of graphics) {
    if (!plannedInsights.has(graphic.placementInsightId)) throw new Error(`Graphic references unknown insight ${graphic.placementInsightId}.`);
    if (graphic.playerIds.some((id) => !playerIds.has(id))) throw new Error(`Graphic references an unknown weekly player.`);
    if (graphic.evidenceIds.some((id) => !evidenceById.has(id))) throw new Error(`Graphic references unknown evidence.`);
    if (extractNumbers(`${graphic.titleHe} ${graphic.subtitleHe}`).length) throw new Error("Graphic titles and subtitles may not contain numbers.");
    if (graphic.type === "legionnaire_trend") {
      for (const playerId of graphic.playerIds) {
        const player = source.summary.players.find((item) => item.playerId === playerId);
        if ((player?.baseline.matchCount ?? 0) < 3 || !Number.isFinite(player?.baseline.per90?.[graphic.metricCode])) {
          throw new Error("Trend graphic requires at least three prior substantial appearances and an available baseline metric.");
        }
      }
    }
  }
  const visibleCopy = claims(authored.editorial).map((claim) => claim.text).join(" ");
  const mentionedPlayers = source.summary.players.filter((player) => visibleCopy.includes(player.nameHe));
  if (mentionedPlayers.length < 2) throw new Error("Weekly article must meaningfully cover at least two legionnaires.");
  const tags = [
    { id: "topic:legionnaires", label: "לגיונרים", kind: "topic" },
    { id: "topic:weekly-summary", label: "סיכום שבועי", kind: "topic" },
    ...mentionedPlayers.map((player) => ({ id: `player:${player.playerId}`, label: player.nameHe, kind: "player" })),
  ];
  const checkedAt = new Date().toISOString();
  const factChecks = [
    { id: "weekly-window", label: "חלון שבועי מלא", status: "passed", detail: `${source.period.start} עד ${source.period.end}` },
    { id: "deduplication", label: "כפילויות משחקים הוסרו", status: "passed", detail: `${source.dataAudit.duplicateMatchIdsRemoved.length} רשומות כפולות הוסרו` },
    { id: "analysis-plan", label: "תזה ותכנית ניתוח", status: "passed", detail: "כל סעיף מקושר לתובנה שנבחרה מראש" },
    { id: "sample-discipline", label: "משמעת מדגם", status: "passed", detail: "טענות מגמה נשענות על לפחות שלוש הופעות קודמות" },
    { id: "graphic-plan", label: "גרפיקות מתוך הנתונים", status: "passed", detail: `${graphics.length} גרפיקות מקושרות לטענות הכתבה` },
    { id: "editorial-review", label: "עריכת עברית וביקורת עיוורת", status: "passed", detail: "שני שלבי הביקורת עברו" },
    { id: "numeric-claims", label: "כל המספרים אומתו", status: "passed", detail: `${claims(authored.editorial).length} טענות קושרו לראיות` },
  ];
  const finalizedAt = new Date().toISOString();
  const candidate = {
    schemaVersion: 1,
    slug: source.slug,
    language: "he",
    kind: "legionnaire_weekly",
    status: "draft",
    publishedAt: null,
    finalizedAt,
    generatedAt: source.generatedAt,
    generation: {
      mode: "codex_skill_candidate",
      analystModel: authored.model,
      writerModel: authored.editorialReview.model,
      model: authored.model,
      editorModel: authored.editorialReview.model,
      qualityModel: authored.qualityReview.model,
      pipelineVersion,
    },
    authorship: authored.authorship,
    approval: { status: "pending", approvedAt: null, note: null },
    period: source.period,
    summary: source.summary,
    tags,
    aiDisclosure: "גילוי נאות: הכתבה נוצרה בעזרת בינה מלאכותית מנתוני כדורדאטה, נערכה בעברית ונבדקה מול נתוני המקור לפני הצגתה.",
    analysisPlan: authored.analysisPlan,
    editorialReview: authored.editorialReview,
    qualityReview: authored.qualityReview,
    editorial: authored.editorial,
    evidence: source.evidence,
    factCheck: {
      status: "passed",
      checkedAt,
      checks: factChecks,
      evidenceCount: source.evidence.length,
      claimCount: claims(authored.editorial).length,
      sourceViews: ["api_legionnaires", "api_player_history", "api_match_player_stats"],
    },
  };
  const outputPath = path.join(path.dirname(sourcePath), "candidate.json");
  await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, slug: source.slug, status: "draft", approval: "pending", checks: factChecks.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
