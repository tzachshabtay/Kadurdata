#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { renderCandidatePreview } from "./content_candidate_preview.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readArguments() {
  const args = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  return {
    candidatePath: valueAfter("--candidate"),
    port: Number(valueAfter("--port") ?? 4174),
  };
}

async function main() {
  const args = readArguments();
  if (!args.candidatePath || !Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) {
    throw new Error("Usage: node scripts/preview_content_candidate.mjs --candidate <candidate.json> [--port <1024-65535>]");
  }
  const candidatePath = path.resolve(projectRoot, args.candidatePath);
  const article = JSON.parse(await readFile(candidatePath, "utf8"));
  const html = renderCandidatePreview(article);
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ status: "ok", slug: article.slug, approval: article.approval.status }));
      return;
    }
    if (request.url !== "/" && request.url !== "/index.html") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    response.end(html);
  });
  server.listen(args.port, "127.0.0.1", () => {
    console.log(JSON.stringify({
      url: `http://127.0.0.1:${args.port}/`,
      candidatePath,
      slug: article.slug,
      approval: article.approval.status,
    }, null, 2));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
