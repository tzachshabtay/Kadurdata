#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { PIPELINE_VERSION } from "./generate_content_article.mjs";
import { buildReviewPacket } from "./content_language_review.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectory = path.join(projectRoot, "src", "content", "generated");
const supportedPipelineVersions = new Set([PIPELINE_VERSION, "legionnaire-weekly-v1"]);

function readArguments() {
  const args = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  return {
    candidatePath: valueAfter("--candidate"),
    approvalNote: valueAfter("--approval-note"),
    approvedByUser: args.includes("--approved-by-user"),
  };
}

function requirePassedReview(review, label) {
  if (review?.status !== "passed" || !review.checks || !Object.values(review.checks).every(Boolean)) {
    throw new Error(`${label} is missing or failed.`);
  }
}

async function main() {
  const args = readArguments();
  if (!args.candidatePath || !args.approvedByUser || !args.approvalNote?.trim()) {
    throw new Error("Usage: node scripts/publish_content_article.mjs --candidate <candidate.json> --approved-by-user --approval-note <note>");
  }

  const candidatePath = path.resolve(projectRoot, args.candidatePath);
  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  if (candidate.status !== "draft" || candidate.generation?.mode !== "codex_skill_candidate") {
    throw new Error("Only a finalized Codex-skill candidate can be published.");
  }
  if (!supportedPipelineVersions.has(candidate.generation?.pipelineVersion)) {
    throw new Error("Candidate was not finalized by the current skill version.");
  }
  if (candidate.approval?.status !== "pending") throw new Error("Candidate is not awaiting approval.");
  if (candidate.factCheck?.status !== "passed" || candidate.factCheck.checks?.some((check) => check.status !== "passed")) {
    throw new Error("Candidate fact checks are missing or failed.");
  }
  requirePassedReview(candidate.editorialReview, "Editorial review");
  requirePassedReview(candidate.qualityReview, "Quality review");
  if (candidate.qualityReview.issues?.length) throw new Error("Candidate still has unresolved quality issues.");
  const packet = buildReviewPacket({
    schemaVersion: 2,
    draftEditorial: null,
    editorial: candidate.editorial,
    analysisPlan: candidate.analysisPlan,
  });
  if (
    candidate.editorialReview.finalHash !== packet.finalHash
    || candidate.qualityReview.reviewedHash !== packet.finalHash
    || candidate.qualityReview.numberlessHash !== packet.numberlessHash
  ) {
    throw new Error("Candidate copy changed after editorial review. Finalize it again before seeking approval.");
  }

  const publishedAt = new Date().toISOString();
  const article = {
    ...candidate,
    status: "published",
    publishedAt,
    generation: {
      ...candidate.generation,
      mode: "codex_skill",
    },
    approval: {
      status: "approved",
      approvedAt: publishedAt,
      note: args.approvalNote.trim(),
    },
  };
  const outputPath = path.join(generatedDirectory, `${candidate.slug}.json`);
  await mkdir(generatedDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(article, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, slug: candidate.slug, approval: "approved", publishedAt }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
