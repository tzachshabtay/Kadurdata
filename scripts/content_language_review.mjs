#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashJson(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function splitSentences(text) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return (normalized.match(/[^.!?…]+(?:[.!?…]+(?=\s|$)|$)/g) ?? [normalized])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function appendSentences(entries, location, text) {
  splitSentences(text).forEach((sentence, index) => {
    entries.push({ location: `${location}.sentence.${index}`, text: sentence });
  });
}

function visibleSentenceEntries(editorial, analysisPlan) {
  const entries = [];
  appendSentences(entries, "editorial.headline", editorial?.headline);
  appendSentences(entries, "editorial.dek", editorial?.dek);
  (editorial?.sections ?? []).forEach((section, sectionIndex) => {
    appendSentences(entries, `editorial.sections.${sectionIndex}.heading`, section.heading);
    (section.paragraphs ?? []).forEach((paragraph, paragraphIndex) => {
      appendSentences(entries, `editorial.sections.${sectionIndex}.paragraphs.${paragraphIndex}`, paragraph.text);
    });
  });
  (editorial?.takeaways ?? []).forEach((takeaway, index) => {
    appendSentences(entries, `editorial.takeaways.${index}`, takeaway.text);
  });
  appendSentences(entries, "editorial.conclusion", editorial?.conclusion);
  (analysisPlan?.graphics ?? []).forEach((graphic, index) => {
    appendSentences(entries, `analysisPlan.graphics.${index}.titleHe`, graphic.titleHe);
    appendSentences(entries, `analysisPlan.graphics.${index}.subtitleHe`, graphic.subtitleHe);
  });
  return entries;
}

function removeNumbers(text) {
  return String(text)
    .replace(/\d+(?:[.,]\d+)?(?:\s*%|\s*xGOT|\s*xG|\s*xA)?/gi, "[מספר]")
    .replace(/(?<![\u0590-\u05FF])(?:אפס|אחת|אחד|שתיים|שניים|שתי|שני|שלוש|שלושה|שלושת|ארבע|ארבעה|ארבעת|חמש|חמישה|חמשת|שש|שישה|ששת|שבע|שבעה|שבעת|שמונה|שמונת|תשע|תשעה|תשעת|עשר|עשרה|עשרת)(?![\u0590-\u05FF])/g, "[מספר]")
    .replace(/\[מספר\](?:\s*[–—-]\s*\[מספר\])+/g, "[טווח מספרי]")
    .replace(/\s+/g, " ")
    .trim();
}

function numberlessEntries(editorial, analysisPlan) {
  return visibleSentenceEntries(editorial, analysisPlan).map((entry) => ({
    ...entry,
    text: removeNumbers(entry.text),
  }));
}

function buildReviewPacket(authored) {
  const sentences = visibleSentenceEntries(authored.editorial, authored.analysisPlan);
  const withoutNumbers = numberlessEntries(authored.editorial, authored.analysisPlan);
  return {
    schemaVersion: authored.schemaVersion,
    draftHash: hashJson(authored.draftEditorial),
    finalHash: hashJson(authored.editorial),
    numberlessHash: hashJson(withoutNumbers),
    sentences,
    numberlessCopy: withoutNumbers,
  };
}

function readArguments() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--authored");
  return { authoredPath: index >= 0 ? args[index + 1] : null };
}

async function main() {
  const { authoredPath } = readArguments();
  if (!authoredPath) throw new Error("Usage: node scripts/content_language_review.mjs --authored <authored.json>");
  const authored = JSON.parse(await readFile(path.resolve(projectRoot, authoredPath), "utf8"));
  console.log(JSON.stringify(buildReviewPacket(authored), null, 2));
}

export {
  buildReviewPacket,
  hashJson,
  numberlessEntries,
  visibleSentenceEntries,
};

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
