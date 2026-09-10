import { createHash } from "node:crypto";
import { buildReviewPacket, hashJson } from "./content_language_review.mjs";

export const LEAGUE_PIPELINE_VERSION = "league-analysis-v1";
export const LEAGUE_ROLES = {
  left_back: ["מגני שמאל", ["Left Back"]],
  right_back: ["מגני ימין", ["Right Back"]],
  fullbacks: ["מגנים", ["Left Back", "Right Back"]],
  centre_forwards: ["חלוצי חוד", ["Centre Forward"]],
  centre_backs: ["בלמים", ["Centre Back"]],
  central_midfield: ["קשרים מרכזיים", ["Central Midfield"]],
  attacking_midfield: ["קשרים התקפיים", ["Attacking Midfield"]],
  wing_forwards: ["שחקני כנף", ["Left Forward", "Right Forward"]],
};
export const LEAGUE_METRICS = ["key_passes", "total_shots", "passes_into_final_third"];
const reviewChecks = ["naturalHebrew", "footballHebrew", "numericClarity", "cohesiveNarrative", "storyValue", "numberDiscipline", "highVolumeComparisonsOnly", "evidenceFaithfulness", "gameStateContext", "graphicRelevance", "explanatoryDepth", "playerRoleAttribution", "historicalAuditComplete"];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rounded = (value, digits) => Number(value.toFixed(digits));
export const snapshotHash = (snapshot) => createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

export function leagueSnapshot(raw) {
  assert(Array.isArray(raw.matches) && raw.matches.length && Array.isArray(raw.players), "Missing league match/player rows.");
  const matches = raw.matches.map(m => ({ matchId: m.match_id, competitionId: m.competition_id, competitionName: m.competition_name, seasonId: m.season_id, seasonName: m.season_name, scheduledAt: m.scheduled_at, status: m.status, roundNumber: m.round_number, homeTeamId: m.home_team_id, awayTeamId: m.away_team_id }));
  const apps = new Map();
  for (const row of raw.players) {
    if (!LEAGUE_METRICS.includes(row.metric_code)) continue;
    assert(Number.isFinite(row.minutes_played) && row.minutes_played >= 0, "Invalid appearance minutes.");
    if (!row.minutes_played) continue;
    assert(Number.isFinite(row.value_numeric) && row.value_numeric >= 0, "Missing or negative player metric.");
    const identity = { appearanceId: row.appearance_id, playerId: row.player_id, matchId: row.match_id, teamId: row.team_id, position: row.formation_position, minutes: row.minutes_played };
    const existing = apps.get(row.appearance_id);
    if (existing) assert(hashJson(identity) === hashJson(existing.identity), "Inconsistent appearance identity/minutes.");
    const app = existing ?? { identity, metrics: {} };
    assert(!(row.metric_code in app.metrics), "Duplicate appearance metric.");
    app.metrics[row.metric_code] = row.value_numeric;
    apps.set(row.appearance_id, app);
  }
  return { matches, appearances: [...apps.values()].map(a => ({ ...a.identity, metrics: a.metrics })) };
}

export function deriveLeagueData(snapshot) {
  const { matches, appearances } = snapshot ?? {};
  assert(Array.isArray(matches) && matches.length && Array.isArray(appearances) && appearances.length, "Empty league snapshot.");
  const ids = new Set(matches.map(m => m.matchId));
  assert(ids.size === matches.length, "Duplicate match IDs.");
  const first = matches[0];
  const teams = new Set();
  const matchById = new Map(matches.map(m => [m.matchId, m]));
  for (const m of matches) {
    assert(m.matchId && m.competitionId && m.seasonId && m.homeTeamId && m.awayTeamId && m.homeTeamId !== m.awayTeamId, "Invalid match identity.");
    assert(m.competitionId === first.competitionId && m.seasonId === first.seasonId && m.seasonName === first.seasonName, "Mixed league/season snapshot.");
    assert(m.competitionName === "Israeli Premier League", "Expected an Israeli Premier League snapshot.");
    assert(["Ended", "After ET", "After Penalties"].includes(m.status) && Number.isFinite(Date.parse(m.scheduledAt)), "Nonterminal or undated league match.");
    teams.add(m.homeTeamId); teams.add(m.awayTeamId);
  }
  const appearanceIds = new Set(), playerMatches = new Set(), coveredSides = new Set();
  for (const a of appearances) {
    const m = matchById.get(a.matchId);
    assert(a.appearanceId && a.playerId && m && [m.homeTeamId, m.awayTeamId].includes(a.teamId), "Appearance outside the selected fixtures.");
    assert(!appearanceIds.has(a.appearanceId) && !playerMatches.has(`${a.matchId}:${a.playerId}`), "Duplicate player appearance.");
    appearanceIds.add(a.appearanceId); playerMatches.add(`${a.matchId}:${a.playerId}`); coveredSides.add(`${a.matchId}:${a.teamId}`);
    assert(typeof a.position === "string" && Number.isFinite(a.minutes) && a.minutes > 0 && a.minutes <= 130, "Invalid role/minute denominator.");
    for (const code of LEAGUE_METRICS) assert(Number.isFinite(a.metrics?.[code]) && a.metrics[code] >= 0, `Incomplete metric coverage: ${code}.`);
  }
  assert(coveredSides.size === matches.length * 2, "Missing player coverage for a match side.");
  const ordered = [...matches].sort((a,b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const rounds = [...new Set(matches.map(m => m.roundNumber))].sort((a,b) => a-b);
  assert(rounds.every(n => Number.isInteger(n) && n > 0), "Missing league rounds.");
  const period = { start: ordered[0].scheduledAt, end: ordered.at(-1).scheduledAt, seasonName: first.seasonName, competitionNameHe: "ליגת העל" };
  const summary = { matches: matches.length, teams: teams.size, rounds, appearances: appearances.length };
  const groups = Object.entries(LEAGUE_ROLES).flatMap(([id, [labelHe, positions]]) => {
    const rows = appearances.filter(a => positions.includes(a.position));
    if (!rows.length) return [];
    const minutes = rows.reduce((sum,a) => sum+a.minutes,0);
    const metrics = Object.fromEntries(LEAGUE_METRICS.map(code => {
      const total = rows.reduce((sum,a) => sum+a.metrics[code],0);
      return [code, { total, per90: rounded(total*90/minutes,2), per90OneDecimal: rounded(total*90/minutes,1), coverage: rows.length }];
    }));
    return [{ id, labelHe, positions, appearances: rows.length, uniquePlayers: new Set(rows.map(a=>a.playerId)).size, minutes, metrics }];
  });
  const evidence = [{ id: "scope", label: "חלון הליגה", sourceView: "api_matches", sourceRows: matches.length, values: [matches.length, teams.size, ...rounds, 90], context: { period, summary } }, ...groups.map(g => ({ id: `position.${g.id}`, label: g.labelHe, sourceView: "api_match_player_stats", sourceRows: g.appearances*LEAGUE_METRICS.length, values: [90,g.appearances,g.uniquePlayers,g.minutes,...Object.values(g.metrics).flatMap(m => [m.total,m.per90,m.per90OneDecimal])], context: g }))];
  return { period, summary, groups, evidence };
}

export function prepareLeagueSource(raw, { slug, generatedAt = new Date().toISOString() }) {
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), "Invalid league article slug.");
  const snapshot = leagueSnapshot(raw);
  return { schemaVersion: 1, kind: "league_analysis", slug, generatedAt, generation: { mode: "codex_skill_workbench", pipelineVersion: LEAGUE_PIPELINE_VERSION }, ...deriveLeagueData(snapshot), snapshot, snapshotHash: snapshotHash(snapshot) };
}

export function assertLeagueData(article) {
  assert(article.kind === "league_analysis" && article.schemaVersion === 1, "Unsupported league source schema.");
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug), "Invalid league article slug.");
  assert(article.snapshotHash === snapshotHash(article.snapshot), "League snapshot hash changed.");
  const actual = deriveLeagueData(article.snapshot);
  for (const key of ["period","summary","groups","evidence"]) assert(hashJson(actual[key]) === hashJson(article[key]), `League ${key} differs from raw snapshot calculations.`);
  return actual;
}

function claimEntries(editorial) {
  return [{ text: editorial.headline, evidenceIds: editorial.headlineEvidenceIds }, { text: editorial.dek, evidenceIds: editorial.dekEvidenceIds }, ...editorial.sections.flatMap(s=>s.paragraphs), ...editorial.takeaways, { text: editorial.conclusion, evidenceIds: editorial.conclusionEvidenceIds }];
}

export function assertLeagueCopy(source, authored, { draftRequired = false } = {}) {
  assert(authored.kind === "league_analysis", "Missing league authoring kind.");
  const roles = authored.authorship;
  const roleIds = [roles?.analystAgentId,roles?.writerAgentId,roles?.editorAgentId,roles?.reviewerAgentId];
  assert(roleIds.every(id=>typeof id === "string" && id.trim()) && new Set(roleIds).size === 4, "Four distinct real role IDs required.");
  const e = authored.editorial, plan = authored.analysisPlan;
  assert(e && plan && typeof plan.thesis === "string" && plan.thesis.trim(), "Missing league thesis/editorial.");
  assert(e.sections?.length >= 3 && e.sections.length <= 6 && e.takeaways?.length === 3, "League article needs 3–6 sections and three takeaways.");
  assert(typeof authored.aiDisclosure === "string" && authored.aiDisclosure.includes("בינה מלאכותית"), "AI disclosure is required.");
  const evidence = new Map(source.evidence.map(x=>[x.id,x]));
  const insights = new Set(plan.rankedInsights?.map(i=>i.id));
  assert(insights.size >= 3 && insights.size <= 5 && insights.size === plan.rankedInsights.length, "Choose 3–5 distinct league insights.");
  const used = new Set();
  for (const section of e.sections) {
    assert(section.heading?.trim() && section.paragraphs?.length && section.insightIds?.length && section.insightIds.every(id=>insights.has(id)), "Section references an unplanned insight.");
    section.insightIds.forEach(id=>used.add(id));
    assert(!/\d/.test(section.heading), "Section headings must be numberless.");
  }
  assert([...insights].every(id=>used.has(id)), "A planned insight has no article section.");
  for (const insight of plan.rankedInsights) assert(insight.evidenceIds?.length && insight.evidenceIds.every(id=>evidence.has(id)), "Insight lacks known evidence.");
  const claims = claimEntries(e);
  for (const claim of claims) {
    assert(typeof claim.text === "string" && claim.text.trim() && claim.evidenceIds?.length, "Empty or uncited claim.");
    assert(claim.evidenceIds.every(id=>evidence.has(id)), "Unknown claim evidence.");
    const values = claim.evidenceIds.flatMap(id=>evidence.get(id).values);
    for (const token of claim.text.match(/\d+(?:\.\d+)?/g) ?? []) assert(values.some(v=>Math.abs(v-Number(token))<1e-9), `Unsupported number ${token}: ${claim.text}`);
  }
  assert(plan.graphics?.length >= 2 && plan.graphics.length <= 4, "Select 2–4 league graphics.");
  const groups = new Set(source.groups.map(g=>g.id));
  for (const g of plan.graphics) {
    assert(g.type === "league_role_comparison" && ["grouped","panels"].includes(g.layout) && g.unit === "per90", "Unsupported league graphic.");
    assert(g.titleHe?.trim() && g.subtitleHe?.trim() && !/\d/.test(g.titleHe+g.subtitleHe), "Graphic titles/subtitles must be numberless.");
    assert(insights.has(g.placementInsightId), "Unknown graphic placement insight.");
    assert(g.groups?.length >= 2 && g.groups.length <= 8 && new Set(g.groups).size === g.groups.length && g.groups.every(id=>groups.has(id)), "Unknown or duplicate graphic group.");
    assert(g.metrics?.length >= 1 && g.metrics.length <= 3 && new Set(g.metrics).size === g.metrics.length && g.metrics.every(code=>LEAGUE_METRICS.includes(code)), "Unsupported graphic metric.");
    assert(g.evidenceIds?.every(id=>evidence.has(id)) && g.groups.every(id=>g.evidenceIds.includes(`position.${id}`)), "Graphic missing its groups' evidence.");
  }
  const packet = buildReviewPacket({ ...authored, draftEditorial: authored.draftEditorial ?? null });
  assert(!packet.sentences.some(s=>s.text.includes("—")), "Run content:postprocess before review.");
  for (const [label,review] of [["editor",authored.editorialReview],["reviewer",authored.qualityReview]]) {
    assert(review?.status === "passed" && reviewChecks.every(k=>review.checks?.[k] === true), `${label} review incomplete.`);
    const entries = new Map(review.sentenceReviews?.map(s=>[s.location,s]));
    assert(entries.size === packet.sentences.length && review.sentenceReviews.length === packet.sentences.length && packet.sentences.every(s=>entries.get(s.location)?.text === s.text && entries.get(s.location)?.verdict === "passed"), `${label} must review every exact visible sentence.`);
  }
  const er=authored.editorialReview, qr=authored.qualityReview;
  assert(er.mode === "codex_skill_editor" && qr.mode === "codex_skill_quality_gate" && er.writerAgentId === roles.writerAgentId && er.editorAgentId === roles.editorAgentId && qr.reviewerAgentId === roles.reviewerAgentId, "Review role identity mismatch.");
  assert(er.finalHash === packet.finalHash && qr.reviewedHash === packet.finalHash && qr.numberlessHash === packet.numberlessHash, "Reviewed copy/graphics/disclosure changed.");
  assert(qr.issues?.length === 0 && qr.numberlessReview?.status === "passed" && qr.numberlessReview.articleStillCoherent === true && qr.numberlessReview.issues?.length === 0 && Number.isInteger(qr.attempt) && qr.attempt > 0, "Blind numberless review failed.");
  assert(er.changes?.length >= 3 && er.changes.every(c=>c.original?.trim() && c.revised?.trim() && c.original !== c.revised && c.reasonHe?.trim()), "At least three concrete editorial edits required.");
  if (draftRequired) assert(authored.draftEditorial && er.draftHash === packet.draftHash, "Draft hash mismatch.");
  return { claims: claims.length, sentences: packet.sentences.length };
}

export function finalizeLeagueArticle(source, authored, now = new Date().toISOString()) {
  assert(source.generation?.mode === "codex_skill_workbench" && source.generation.pipelineVersion === LEAGUE_PIPELINE_VERSION, "Source is not a prepared league workbench.");
  assertLeagueData(source);
  assert(authored.schemaVersion === 2 && authored.model === "gpt-6-astra" && authored.editorialReview?.model === "gpt-6-astra" && authored.qualityReview?.model === "gpt-6-astra", "League authoring requires the recorded GPT-6 Astra roles.");
  const counts = assertLeagueCopy(source,authored,{draftRequired:true});
  const checks = [
    ["league-window","חלון ליגה אחיד",`${source.summary.matches} משחקים באותה ליגה ועונה`],
    ["deduplication","ללא הופעות כפולות",`${source.summary.appearances} הופעות ייחודיות`],
    ["metric-coverage","כיסוי מדדים מלא","כל מדד קיים במפורש לכל הופעה שנכללה"],
    ["normalization","השוואה לפי דקות משחק","הסכומים והממוצעים ל־90 דקות חושבו מחדש"],
    ["analysis-plan","תכנית ניתוח מקושרת","כל הסעיפים מקושרים לתובנות ולראיות"],
    ["graphic-plan","תרשימים תואמים לראיות","הקבוצות והמדדים נבדקו מול המקור"],
    ["editorial-review","עריכה וביקורת עצמאיות",`${counts.sentences} משפטים בנוסח הסופי נבדקו`],
    ["numberless-story","סיפור גם ללא מספרים","הנוסח עבר קריאה עצמאית ללא מספרים"],
    ["numeric-claims","כל המספרים מקושרים לראיות",`${counts.claims} טענות נבדקו`],
  ].map(([id,label,detail])=>({id,label,detail,status:"passed"}));
  return { ...source, language:"he",status:"draft",publishedAt:null,finalizedAt:now,generation:{mode:"codex_skill_candidate",pipelineVersion:LEAGUE_PIPELINE_VERSION,model:authored.model,analystModel:authored.model,writerModel:authored.model,editorModel:authored.editorialReview.model,qualityModel:authored.qualityReview.model},authorship:authored.authorship,approval:{status:"pending",approvedAt:null,note:null},tags:[{id:"topic:league-analysis",label:"ניתוח ליגה",kind:"topic"},{id:"topic:positions",label:"תפקידים במגרש",kind:"topic"}],aiDisclosure:authored.aiDisclosure,analysisPlan:authored.analysisPlan,editorial:authored.editorial,editorialReview:authored.editorialReview,qualityReview:authored.qualityReview,factCheck:{status:"passed",checkedAt:now,checks,evidenceCount:source.evidence.length,claimCount:counts.claims,sourceViews:["api_matches","api_match_player_stats"]} };
}
