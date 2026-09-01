#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function normalizeVisibleString(value) {
  return typeof value === "string" ? value.replaceAll("—", "-") : value;
}

function normalizeStrings(value) {
  if (Array.isArray(value)) return value.map(normalizeStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeStrings(child)]));
  }
  return normalizeVisibleString(value);
}

function postprocessVisibleCopy(authored) {
  const processed = {
    ...authored,
    editorial: normalizeStrings(authored.editorial),
    ...(Array.isArray(authored.playerRecaps) ? { playerRecaps: normalizeStrings(authored.playerRecaps) } : {}),
    analysisPlan: {
      ...authored.analysisPlan,
      graphics: (authored.analysisPlan?.graphics ?? []).map((graphic) => ({
        ...graphic,
        titleHe: normalizeVisibleString(graphic.titleHe),
        subtitleHe: normalizeVisibleString(graphic.subtitleHe),
      })),
    },
  };
  return processed;
}

function countEmDashes(value) {
  return (JSON.stringify(value ?? "").match(/—/g) ?? []).length;
}

function readArguments() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--authored");
  return {
    authoredPath: index >= 0 ? args[index + 1] : null,
    check: args.includes("--check"),
  };
}

async function main() {
  const args = readArguments();
  if (!args.authoredPath) {
    throw new Error("Usage: node scripts/postprocess_content_article.mjs --authored <authored.json> [--check]");
  }
  const authoredPath = path.resolve(projectRoot, args.authoredPath);
  const authored = JSON.parse(await readFile(authoredPath, "utf8"));
  const processed = postprocessVisibleCopy(authored);
  const replacements = countEmDashes(authored.editorial)
    + countEmDashes(authored.playerRecaps ?? [])
    + countEmDashes(authored.analysisPlan?.graphics ?? []);
  if (args.check && replacements > 0) {
    throw new Error(`Visible article copy still contains ${replacements} em dash character(s). Run content:postprocess before review.`);
  }
  if (!args.check && replacements > 0) {
    await writeFile(authoredPath, `${JSON.stringify(processed, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ authoredPath, replacements, changed: !args.check && replacements > 0, check: args.check }, null, 2));
}

export { postprocessVisibleCopy };

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
