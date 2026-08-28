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
  for (const marker of ["להחליף", "טרם בוצעה", "configured-codex-model"]) {
    if (text.includes(marker)) throw new Error(`Authored package still contains scaffold text: ${marker}`);
  }
}

async function main() {
  const args = readArguments();
  if (!args.sourcePath || !args.authoredPath) {
    throw new Error("Usage: node scripts/finalize_content_article.mjs --source <source.json> --authored <authored.json> [--dry-run]");
  }

  const sourcePath = path.resolve(projectRoot, args.sourcePath);
  const authoredPath = path.resolve(projectRoot, args.authoredPath);
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const authored = JSON.parse(await readFile(authoredPath, "utf8"));
  if (source.generation?.mode !== "codex_skill_workbench" || source.generation?.pipelineVersion !== PIPELINE_VERSION) {
    throw new Error("Source package was not prepared by the current Codex skill workbench.");
  }
  if (authored.schemaVersion !== 1) throw new Error("Authored package has an unsupported schemaVersion.");
  if (authored.source && path.resolve(path.dirname(authoredPath), authored.source) !== sourcePath) {
    throw new Error("Authored package points to a different source file.");
  }
  rejectScaffoldText(authored);
  if (!authored.analysisPlan || !authored.editorial) throw new Error("Authored package must include analysisPlan and editorial.");
  requireCompleteReview(authored.editorialReview, "Editorial review");
  requireCompleteReview(authored.qualityReview, "Quality review");
  if (authored.qualityReview.issues?.length) throw new Error("Quality review still contains unresolved issues.");

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

  const publishedAt = new Date().toISOString();
  const { _workbench, ...publishableSource } = source;
  const article = {
    ...publishableSource,
    status: "published",
    publishedAt,
    generation: {
      mode: "codex_skill",
      analystModel: model,
      model,
      editorModel: model,
      qualityModel: model,
      pipelineVersion: PIPELINE_VERSION,
    },
    tags,
    analysisPlan: authored.analysisPlan,
    editorialReview,
    qualityReview,
    editorial: authored.editorial,
    factCheck: {
      status: "passed",
      checkedAt: publishedAt,
      checks,
      evidenceCount: source.evidence.length,
      claimCount: claimEntries(authored.editorial).length,
      sourceViews: source.factCheck.sourceViews,
    },
  };
  const outputPath = args.outputPath
    ? path.resolve(projectRoot, args.outputPath)
    : path.join(generatedDirectory, `${source.slug}.json`);
  if (!args.dryRun) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(article, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ outputPath, slug: source.slug, checks: checks.length, dryRun: args.dryRun }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
