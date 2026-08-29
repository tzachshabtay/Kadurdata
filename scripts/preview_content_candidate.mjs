#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewDirectory = path.join(projectRoot, "src", "content", "review");

function readArguments() {
  const args = process.argv.slice(2);
  const candidatePaths = [];
  let port = 4174;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--candidate" && args[index + 1]) {
      candidatePaths.push(args[index + 1]);
      index += 1;
    } else if (args[index] === "--port" && args[index + 1]) {
      port = Number(args[index + 1]);
      index += 1;
    }
  }
  return { candidatePaths, port };
}

function validateCandidate(article, candidatePath) {
  if (article.status !== "draft" || article.approval?.status !== "pending") {
    throw new Error(`${candidatePath} is not a pending draft candidate.`);
  }
  if (article.generation?.mode !== "codex_skill_candidate") {
    throw new Error(`${candidatePath} was not finalized by the Codex skill candidate pipeline.`);
  }
  if (!article.slug || article.language !== "he") {
    throw new Error(`${candidatePath} is missing a Hebrew article slug or language marker.`);
  }
}

async function clearStagedCandidates() {
  await mkdir(reviewDirectory, { recursive: true });
  const names = await readdir(reviewDirectory);
  await Promise.all(names
    .filter((name) => name.endsWith(".json"))
    .map((name) => unlink(path.join(reviewDirectory, name))));
}

async function stageCandidates(candidatePaths) {
  await clearStagedCandidates();
  const staged = [];
  for (const relativeCandidatePath of candidatePaths) {
    const candidatePath = path.resolve(projectRoot, relativeCandidatePath);
    const article = JSON.parse(await readFile(candidatePath, "utf8"));
    validateCandidate(article, candidatePath);
    const stagedPath = path.join(reviewDirectory, `${article.slug}.json`);
    await writeFile(stagedPath, `${JSON.stringify(article, null, 2)}\n`, "utf8");
    staged.push({ candidatePath, stagedPath, slug: article.slug, headline: article.editorial.headline });
  }
  return staged;
}

async function main() {
  const args = readArguments();
  if (!args.candidatePaths.length || !Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) {
    throw new Error("Usage: node scripts/preview_content_candidate.mjs --candidate <candidate.json> [--candidate <candidate.json> ...] [--port <1024-65535>]");
  }
  const staged = await stageCandidates(args.candidatePaths);
  const url = `http://127.0.0.1:${args.port}/?lang=he&review=all#blog`;
  console.log(JSON.stringify({
    url,
    mode: "production-components-local-review",
    candidates: staged,
  }, null, 2));

  const vitePath = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [vitePath, "--host", "127.0.0.1", "--port", String(args.port), "--strictPort"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  const stop = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
