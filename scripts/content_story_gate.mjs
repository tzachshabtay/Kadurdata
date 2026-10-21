import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewPacket, hashJson } from "./content_language_review.mjs";
import { reportingEvidence, assertContextUse, withMatchContextEvidence } from "./content_match_context.mjs";
import { matchPlayerRecapEvidence } from "./content_match_player_recaps.mjs";

export const STORY_GATE_VERSION = 1;
export const blankStoryBrief = () => ({ status: "reject", questionHe: "", answerHe: "", tensionHe: "", whyItMattersHe: "", evidenceIds: [], rejectionReasonHe: "" });
const requireValue = (condition, message) => { if (!condition) throw new Error(`Story gate: ${message}`); };
const hebrewText = value => typeof value === "string" && value.trim() && /[\u0590-\u05FF]/u.test(value);

// Validate the editorial handoff, not a statistical definition of interesting.
// The analyst and independent reader must judge the premise and explanation.
export function assertStoryBrief(brief, evidence) {
  requireValue(brief && typeof brief === "object", "a pre-draft story brief is required.");
  requireValue(brief.status === "ready", `premise rejected or unfinished: ${brief.rejectionReasonHe || "record the analyst's decision"}`);
  for (const key of ["questionHe", "answerHe", "tensionHe", "whyItMattersHe"]) {
    requireValue(hebrewText(brief[key]), `storyBrief.${key} needs a concrete Hebrew explanation.`);
  }
  const known = new Set((evidence ?? []).map(item => item.id));
  requireValue(Array.isArray(brief.evidenceIds) && brief.evidenceIds.length > 0
    && new Set(brief.evidenceIds).size === brief.evidenceIds.length
    && brief.evidenceIds.every(id => known.has(id)), "the brief must cite distinct, available evidence.");
  return brief;
}

export function storyEvidenceHash(brief, evidence) {
  const byId = new Map(evidence.map(item => [item.id, item]));
  // Context-enabled packages bind the native evidence behind the added insight
  // as well as background. Legacy packages keep their original hash contract.
  const contextEnabled = evidence.some(e => e.id.startsWith('context.'));
  const ids = [...new Set([...brief.evidenceIds, ...(contextEnabled ? evidence.map(e => e.id) : [])])];
  return hashJson(ids.map(id => byId.get(id)));
}

export function assertStoryGate(authored, evidence, { contextRequired = false, internalReportingRequired = false } = {}) {
  const brief = assertStoryBrief(authored.analysisPlan?.storyBrief, evidence);
  assertContextUse(authored, evidence, { required: contextRequired, internalRequired: internalReportingRequired });
  const review = authored.qualityReview?.storyReview;
  requireValue(review?.status === "passed" && Array.isArray(review.issues) && review.issues.length === 0,
    "the blind reader must pass the narrative review with no unresolved issues.");
  requireValue(review.briefHash === hashJson(brief), "the premise changed after blind review.");
  requireValue(review.evidenceHash === storyEvidenceHash(brief, evidence), "the decisive evidence changed after review.");
  const packet = buildReviewPacket({ ...authored, draftEditorial: authored.draftEditorial ?? null });
  requireValue(review.reviewedContentHash === packet.storyContentHash, "the story or graphic selection changed after review.");
  requireValue(authored.qualityReview.reviewedHash === packet.finalHash
    && authored.qualityReview.numberlessHash === packet.numberlessHash, "the narrative review must cover the exact final and numberless copy.");
  for (const key of ["summaryHe", "explanationHe", "readerValueHe"]) {
    requireValue(hebrewText(review[key]), `storyReview.${key} needs the blind reader's own assessment.`);
  }
  const sections = authored.editorial?.sections ?? [], progression = review.sectionProgression;
  requireValue(sections.length > 0 && Array.isArray(progression) && progression.length === sections.length,
    "the reader must explain what each body section adds.");
  requireValue(progression.every(item => item && Number.isInteger(item.sectionIndex) && item.sectionIndex >= 0
      && item.sectionIndex < sections.length && hebrewText(item.addsHe))
    && new Set(progression.map(item => item.sectionIndex)).size === sections.length, "section progression has missing, duplicate or invalid entries.");
  const bodyEvidence = new Set(sections.flatMap(s => (s.paragraphs ?? []).flatMap(p => p.evidenceIds ?? [])));
  requireValue(brief.evidenceIds.every(id => bodyEvidence.has(id)), "the decisive brief evidence must be used in the article body.");
  return { briefHash: hashJson(brief), sections: sections.length };
}

// Existing reviewed packages retain their original contract. New finalizations
// carry a version; deleting their brief must not turn them into legacy content.
export function assertStoredStoryGate(article) {
  const version = article.generation?.storyGateVersion;
  requireValue(version === undefined || version === STORY_GATE_VERSION, "unsupported story gate version.");
  const contextVersion = article.generation?.matchContextVersion;
  requireValue(contextVersion === undefined || [1, 2].includes(contextVersion), "unsupported match context version.");
  if (version !== undefined || article.analysisPlan?.storyBrief
    || article.factCheck?.checks?.some(check => check.id === "story-contract")) {
    if (article.matchContext) {
      const derived = withMatchContextEvidence([], article.matchContext);
      requireValue(derived.every(item => hashJson(item) === hashJson(article.evidence.find(e => e.id === item.id))), "historical context differs from its reviewed evidence.");
    }
    return assertStoryGate(article, article.evidence, { contextRequired: contextVersion >= 1, internalReportingRequired: contextVersion === 2 });
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
  if (!args.includes("--source") || !args.includes("--authored")) throw new Error("Usage: content:check:story --source <source.json> --authored <authored.json>");
  const source = JSON.parse(await readFile(path.resolve(value("--source")), "utf8"));
  const authored = JSON.parse(await readFile(path.resolve(value("--authored")), "utf8"));
  const evidence = [...withMatchContextEvidence(source.evidence, source.matchContext), ...reportingEvidence(authored.reportingContext), ...(authored.playerRecaps ? matchPlayerRecapEvidence(source.players) : [])];
  const brief = assertStoryBrief(authored.analysisPlan?.storyBrief, evidence);
  console.log(JSON.stringify({ status: "ready_for_writer", storyBriefHash: hashJson(brief), evidenceHash: storyEvidenceHash(brief, evidence), note: "Premise handoff checked; independent narrative review is still required before finalization." }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
