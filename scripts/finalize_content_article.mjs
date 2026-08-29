#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  EDITORIAL_REVIEW_MODE,
  PIPELINE_VERSION,
  QUALITY_REVIEW_MODE,
  buildArticleTags,
  buildChecks,
  claimEntries,
} from "./generate_content_article.mjs";
import { buildReviewPacket } from "./content_language_review.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectory = path.join(projectRoot, "src", "content", "generated");

function readArguments() {
  const args = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  return {
    sourcePath: valueAfter("--source"),
    authoredPath: valueAfter("--authored"),
    outputPath: valueAfter("--output"),
    dryRun: args.includes("--dry-run"),
  };
}

function requireCompleteReview(review, label) {
  if (!review || review.status !== "passed") throw new Error(`${label} has not passed.`);
  if (!review.checks || !Object.values(review.checks).every(Boolean)) {
    throw new Error(`${label} contains an unchecked or failed criterion.`);
  }
}

function rejectScaffoldText(authored) {
  const text = JSON.stringify(authored);
  for (const marker of [
    "להחליף",
    "טרם בוצעה",
    "configured-codex-model",
    "analyst-agent-id",
    "writer-agent-id",
    "editor-agent-id",
    "reviewer-agent-id",
    "pending-draft-hash",
    "pending-final-hash",
    "pending-numberless-hash",
  ]) {
    if (text.includes(marker)) throw new Error(`Authored package still contains scaffold text: ${marker}`);
  }
}

const EDIT_CATEGORIES = new Set([
  "translationese",
  "abstract_language",
  "football_register",
  "clarity",
  "rhythm",
  "numeric_overload",
  "cohesion",
]);

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function requireSentenceCoverage(reviews, expected, label) {
  if (!Array.isArray(reviews) || reviews.length !== expected.length) {
    throw new Error(`${label} must cover all ${expected.length} visible sentences exactly once.`);
  }
  const byLocation = new Map();
  for (const review of reviews) {
    requireString(review.location, `${label} location`);
    if (byLocation.has(review.location)) throw new Error(`${label} contains a duplicate location: ${review.location}`);
    byLocation.set(review.location, review);
  }
  for (const entry of expected) {
    const review = byLocation.get(entry.location);
    if (!review || review.text !== entry.text) throw new Error(`${label} does not match final copy at ${entry.location}.`);
    if (review.verdict !== "passed") throw new Error(`${label} rejected the sentence at ${entry.location}.`);
    requireString(review.noteHe, `${label} note at ${entry.location}`);
  }
}

function requireLanguageReviewArtifacts(authored) {
  const authorship = authored.authorship;
  if (!authorship) throw new Error("Authorship metadata is missing.");
  const roleIds = [
    authorship.analystAgentId,
    authorship.writerAgentId,
    authorship.editorAgentId,
    authorship.reviewerAgentId,
  ];
  roleIds.forEach((id, index) => requireString(id, `Authorship role ${index + 1}`));
  if (new Set(roleIds).size !== roleIds.length) {
    throw new Error("Analyst, writer, Hebrew editor, and blind reviewer must use distinct agent IDs.");
  }
  if (!authored.draftEditorial) throw new Error("The writer's draftEditorial artifact is missing.");

  const packet = buildReviewPacket(authored);
  const editorialReview = authored.editorialReview;
  const qualityReview = authored.qualityReview;
  if (editorialReview.writerAgentId !== authorship.writerAgentId || editorialReview.editorAgentId !== authorship.editorAgentId) {
    throw new Error("Editorial review role IDs do not match authorship metadata.");
  }
  if (qualityReview.reviewerAgentId !== authorship.reviewerAgentId) {
    throw new Error("Quality review role ID does not match authorship metadata.");
  }
  if (editorialReview.draftHash !== packet.draftHash || editorialReview.finalHash !== packet.finalHash) {
    throw new Error("Editorial review hashes do not match the exact draft and final copy.");
  }
  if (packet.draftHash === packet.finalHash) throw new Error("The Hebrew editor did not change the writer's draft.");
  if (qualityReview.reviewedHash !== packet.finalHash || qualityReview.numberlessHash !== packet.numberlessHash) {
    throw new Error("Blind-review hashes do not match the exact final and numberless copy.");
  }

  if (!Array.isArray(editorialReview.changes) || editorialReview.changes.length < 3) {
    throw new Error("Hebrew editorial review must record at least three concrete changes.");
  }
  const draftCopy = JSON.stringify(authored.draftEditorial);
  const finalCopy = JSON.stringify(authored.editorial);
  for (const [index, change] of editorialReview.changes.entries()) {
    requireString(change.location, `Editorial change ${index + 1} location`);
    requireString(change.original, `Editorial change ${index + 1} original`);
    requireString(change.revised, `Editorial change ${index + 1} revision`);
    requireString(change.reasonHe, `Editorial change ${index + 1} reason`);
    if (change.original === change.revised) throw new Error(`Editorial change ${index + 1} did not alter the text.`);
    if (!draftCopy.includes(change.original) || !finalCopy.includes(change.revised)) {
      throw new Error(`Editorial change ${index + 1} is not grounded in the stored draft and final copy.`);
    }
    if (!EDIT_CATEGORIES.has(change.category)) throw new Error(`Editorial change ${index + 1} uses an unsupported category.`);
  }

  requireSentenceCoverage(editorialReview.sentenceReviews, packet.sentences, "Hebrew editorial review");
  requireSentenceCoverage(qualityReview.sentenceReviews, packet.sentences, "Blind Hebrew review");
  const numberlessReview = qualityReview.numberlessReview;
  if (
    numberlessReview?.status !== "passed"
    || numberlessReview.articleStillCoherent !== true
    || !Array.isArray(numberlessReview.issues)
    || numberlessReview.issues.length > 0
  ) {
    throw new Error("The article did not pass the blind numberless-story review.");
  }
  requireString(numberlessReview.summaryHe, "Numberless-story review summary");
  if (numberlessReview.summaryHe.length < 30 || !/[\u0590-\u05FF]/.test(numberlessReview.summaryHe)) {
    throw new Error("Numberless-story review summary must contain a substantive Hebrew explanation.");
  }
  return packet;
}

async function main() {
  const args = readArguments();
  if (!args.sourcePath || !args.authoredPath) {
    throw new Error("Usage: node scripts/finalize_content_article.mjs --source <source.json> --authored <authored.json> [--output <candidate.json>] [--dry-run]");
  }

  const sourcePath = path.resolve(projectRoot, args.sourcePath);
  const authoredPath = path.resolve(projectRoot, args.authoredPath);
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const authored = JSON.parse(await readFile(authoredPath, "utf8"));
  if (source.generation?.mode !== "codex_skill_workbench" || source.generation?.pipelineVersion !== PIPELINE_VERSION) {
    throw new Error("Source package was not prepared by the current Codex skill workbench.");
  }
  if (authored.schemaVersion !== 2) throw new Error("Authored package has an unsupported schemaVersion.");
  if (authored.source && path.resolve(path.dirname(authoredPath), authored.source) !== sourcePath) {
    throw new Error("Authored package points to a different source file.");
  }
  rejectScaffoldText(authored);
  if (!authored.analysisPlan || !authored.editorial) throw new Error("Authored package must include analysisPlan and editorial.");
  requireCompleteReview(authored.editorialReview, "Editorial review");
  requireCompleteReview(authored.qualityReview, "Quality review");
  if (authored.qualityReview.issues?.length) throw new Error("Quality review still contains unresolved issues.");
  requireLanguageReviewArtifacts(authored);

  const model = authored.model || "codex-scheduled-task";
  const editorialReview = {
    ...authored.editorialReview,
    mode: EDITORIAL_REVIEW_MODE,
    model,
  };
  const qualityReview = {
    ...authored.qualityReview,
    mode: QUALITY_REVIEW_MODE,
    model,
  };
  const tags = buildArticleTags(source.teams.home, source.teams.away, source.players, authored.editorial);
  const rawMatch = source._workbench?.rawMatch;
  const rawShots = source._workbench?.rawShots;
  if (!rawMatch || !Array.isArray(rawShots)) throw new Error("Source package is missing deterministic workbench inputs.");

  const checks = buildChecks(
    rawMatch,
    source.teams.home,
    source.teams.away,
    source.players,
    rawShots,
    source.evidence,
    authored.editorial,
    editorialReview,
    qualityReview,
    source.flowWindows,
    source.timelineEvents,
    source.spatialProfile,
    source.historicalContext,
    tags,
    true,
    authored.analysisPlan,
    source.insightCandidates,
    source.gameStateContext,
    source.mechanismContext,
  );
  const failedChecks = checks.filter((check) => check.status === "failed");
  if (failedChecks.length) {
    throw new Error(`Article rejected by deterministic finalization:\n${failedChecks.map((check) => `- ${check.label}: ${check.detail}`).join("\n")}`);
  }

  const finalizedAt = new Date().toISOString();
  const { _workbench, ...publishableSource } = source;
  const article = {
    ...publishableSource,
    status: "draft",
    publishedAt: null,
    finalizedAt,
    generation: {
      mode: "codex_skill_candidate",
      analystModel: model,
      writerModel: model,
      model,
      editorModel: model,
      qualityModel: model,
      pipelineVersion: PIPELINE_VERSION,
    },
    authorship: authored.authorship,
    tags,
    analysisPlan: authored.analysisPlan,
    editorialReview,
    qualityReview,
    editorial: authored.editorial,
    approval: {
      status: "pending",
      approvedAt: null,
      note: null,
    },
    factCheck: {
      status: "passed",
      checkedAt: finalizedAt,
      checks,
      evidenceCount: source.evidence.length,
      claimCount: claimEntries(authored.editorial).length,
      sourceViews: source.factCheck.sourceViews,
    },
  };
  const outputPath = args.outputPath
    ? path.resolve(projectRoot, args.outputPath)
    : path.join(path.dirname(sourcePath), "candidate.json");
  if (outputPath === generatedDirectory || outputPath.startsWith(`${generatedDirectory}${path.sep}`)) {
    throw new Error("Finalization cannot write to the public blog. Write a candidate, then use content:publish after explicit user approval.");
  }
  if (!args.dryRun) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(article, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ candidatePath: outputPath, slug: source.slug, checks: checks.length, approval: "pending", dryRun: args.dryRun }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
