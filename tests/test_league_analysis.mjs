import test from "node:test";
import assert from "node:assert/strict";
import { prepareLeagueSource, finalizeLeagueArticle, assertLeagueData, assertLeagueCopy, addLeagueClubComparison, LEAGUE_METRICS } from "../scripts/content_league_analysis.mjs";
import { buildReviewPacket } from "../scripts/content_language_review.mjs";
import { validateArticle } from "../scripts/validate_content_articles.mjs";

function fixture() {
  const match={match_id:"fixture-match",competition_id:"league",competition_name:"Israeli Premier League",season_id:"season",season_name:"2026/2027",scheduled_at:"2026-09-01T16:00:00Z",status:"Ended",round_number:1,home_team_id:"home",away_team_id:"away"};
  const players=[['back','Left Back','home',86,1],['forward','Centre Forward','away',90,2],['wing','Left Forward','home',90,3]].flatMap(([id,role,team,minutes,keypasses])=>LEAGUE_METRICS.map(code=>({appearance_id:id,player_id:id,match_id:match.match_id,team_id:team,formation_position:role,minutes_played:minutes,metric_code:code,value_numeric:code==='key_passes'?keypasses:code==='total_shots'?2:5})));
  return {matches:[match],players};
}

// Synthetic reviews are test fixtures only. Production authorship comes from real roles.
function authored(source) {
  const claim={text:"המגנים תרמו במסירה.",evidenceIds:["position.fullbacks"]};
  const editorial={headline:"המגנים והמסירה",headlineEvidenceIds:claim.evidenceIds,dek:"המגנים השתתפו בהתקפה.",dekEvidenceIds:claim.evidenceIds,sections:["creation","shooting","progression"].map(id=>({heading:`השוואת תפקידים ${id}`,insightIds:[id],paragraphs:[claim]})),takeaways:[claim,claim,claim],conclusion:"תרומתם ניכרה במסירה.",conclusionEvidenceIds:claim.evidenceIds};
  const graphics=["creation","progression"].map(id=>({id,type:"league_role_comparison",layout:"grouped",groups:["fullbacks","centre_forwards"],metrics:["key_passes"],unit:"per90",titleHe:"המגנים והחלוצים במסירה",subtitleHe:"לפי דקות המשחק בעמדה",placementInsightId:id,evidenceIds:["position.fullbacks","position.centre_forwards"]}));
  const a={schemaVersion:2,kind:"league_analysis",model:"gpt-6-astra",authorship:{analystAgentId:"fixture:analyst",writerAgentId:"fixture:writer",editorAgentId:"fixture:editor",reviewerAgentId:"fixture:reviewer"},aiDisclosure:"הכתבה נכתבה בעזרת בינה מלאכותית.",draftEditorial:{...editorial,headline:"נוסח טיוטה"},editorial,analysisPlan:{thesis:"תפקידים שונים במסירה",rankedInsights:["creation","shooting","progression"].map(id=>({id,evidenceIds:claim.evidenceIds})),graphics}};
  const p=buildReviewPacket(a),sentenceReviews=p.sentences.map(s=>({...s,verdict:"passed",noteHe:"Synthetic test fixture"}));
  const checks=Object.fromEntries(["naturalHebrew","footballHebrew","numericClarity","cohesiveNarrative","storyValue","numberDiscipline","highVolumeComparisonsOnly","evidenceFaithfulness","gameStateContext","graphicRelevance","explanatoryDepth","playerRoleAttribution","historicalAuditComplete"].map(k=>[k,true]));
  a.editorialReview={mode:"codex_skill_editor",model:a.model,status:"passed",writerAgentId:a.authorship.writerAgentId,editorAgentId:a.authorship.editorAgentId,draftHash:p.draftHash,finalHash:p.finalHash,sentenceReviews,checks,changes:[1,2,3].map(i=>({location:`fixture.${i}`,original:"נוסח טיוטה",revised:"נוסח סופי",reasonHe:"Synthetic test fixture"}))};
  a.qualityReview={mode:"codex_skill_quality_gate",model:a.model,status:"passed",reviewerAgentId:a.authorship.reviewerAgentId,reviewedHash:p.finalHash,numberlessHash:p.numberlessHash,sentenceReviews:structuredClone(sentenceReviews),checks,issues:[],attempt:1,numberlessReview:{status:"passed",articleStillCoherent:true,summaryHe:"Synthetic test fixture",issues:[]}};
  return a;
}

test("rates use each appearance's minutes once and avoid double rounding",()=>{
  const source=prepareLeagueSource(fixture(),{slug:"fixture-league"});
  const metric=source.groups.find(g=>g.id==='fullbacks').metrics.key_passes;
  assert.equal(metric.per90,1.05);assert.equal(metric.per90OneDecimal,1.0);
  assert.equal(source.summary.appearances,3);assert.equal(source.groups.find(g=>g.id==='wing_forwards').metrics.key_passes.per90,3);
});
test("reject duplicate, missing and foreign-window inputs instead of zero filling",()=>{
  let raw=fixture();raw.players.push(raw.players[0]);assert.throws(()=>prepareLeagueSource(raw,{slug:"fixture"}),/Duplicate/);
  raw=fixture();raw.players.splice(0,1);assert.throws(()=>prepareLeagueSource(raw,{slug:"fixture"}),/Incomplete/);
  raw=fixture();raw.matches[0].status="Live";assert.throws(()=>prepareLeagueSource(raw,{slug:"fixture"}),/Nonterminal/);
  raw=fixture();raw.players[0].team_id="outside";assert.throws(()=>prepareLeagueSource(raw,{slug:"fixture"}),/identity/);
});
test("tampered derived rates and snapshots fail recomputation",()=>{
  const source=prepareLeagueSource(fixture(),{slug:"fixture"});source.groups[0].metrics.key_passes.per90=99;assert.throws(()=>assertLeagueData(source),/differs/);
  const changed=prepareLeagueSource(fixture(),{slug:"fixture"});changed.snapshot.appearances[0].minutes=90;assert.throws(()=>assertLeagueData(changed),/hash changed/);
});
test("finalization is pending and publication validation accepts reviewed league schema",()=>{
  const source=prepareLeagueSource(fixture(),{slug:"fixture"}),a=authored(source),candidate=finalizeLeagueArticle(source,a);
  assert.equal(candidate.status,"draft");assert.equal(candidate.approval.status,"pending");assert.equal(candidate.publishedAt,null);
  const promoted={...candidate,status:"published",publishedAt:new Date().toISOString(),generation:{...candidate.generation,mode:"codex_skill"},approval:{status:"approved",approvedAt:new Date().toISOString(),note:"Synthetic test fixture"}};
  assert.deepEqual(validateArticle(promoted,"fixture.json"),[]);
});
test("review hashes bind chart metrics and disclosure as well as prose",()=>{
  const source=prepareLeagueSource(fixture(),{slug:"fixture"});
  for(const mutate of [a=>a.analysisPlan.graphics[0].metrics.push("total_shots"),a=>a.aiDisclosure+=" טקסט נוסף.",a=>a.editorial.headline+=" תיקון"]){const a=authored(source);mutate(a);assert.throws(()=>assertLeagueCopy(source,a),/changed|exact/);}
});
test("reject omitted reviews, duplicate coverage and incorrect numeric claims",()=>{
  const source=prepareLeagueSource(fixture(),{slug:"fixture"});let a=authored(source);a.qualityReview.checks.storyValue=false;assert.throws(()=>finalizeLeagueArticle(source,a),/incomplete/);
  a=authored(source);a.qualityReview.sentenceReviews[1]=a.qualityReview.sentenceReviews[0];assert.throws(()=>finalizeLeagueArticle(source,a),/every exact/);
  a=authored(source);a.editorial.sections[0].paragraphs=[{text:"המגנים רשמו 99 מסירות.",evidenceIds:["position.fullbacks"]}];assert.throws(()=>finalizeLeagueArticle(source,a),/Unsupported number/);
});

test("club comparisons exclude the focal club and use all roles in share denominators", () => {
  const original = prepareLeagueSource(fixture(), {slug:"fixture"});
  const source = addLeagueClubComparison(original, {home:"בית",away:"חוץ"}, {back:"מגן"});
  assert.equal(original.clubComparison, undefined);
  assert.equal(source.snapshotHash, original.snapshotHash);
  const home = source.clubComparison.clubs.find(c => c.teamId === "home");
  const back = home.groups.find(g => g.id === "left_back");
  assert.equal(back.metrics.key_passes.per90, 1.05);
  assert.equal(back.metrics.key_passes.teamShare, 25); // 1 of all 4 team key passes.
  assert.equal(home.rest.groups.find(g => g.id === "centre_forwards").metrics.key_passes.per90, 2);
  assert.equal(home.groups.find(g => g.id === "centre_forwards").metrics.key_passes.per90, null);
  assert.equal(home.byMatch[0].groups.find(g => g.id === "left_back").minutes, 86);
  assert.equal(source.evidence.find(e => e.id === "league.player.back").context.minutes, 86);
  assert.doesNotThrow(() => assertLeagueData(source));
});

test("club comparison tampering cannot survive source validation", () => {
  const source = addLeagueClubComparison(prepareLeagueSource(fixture(), {slug:"fixture"}), {home:"בית",away:"חוץ"});
  for (const mutate of [s => s.clubComparison.clubs[0].rest.groups[0].metrics.key_passes.per90 = 88, s => s.evidence.at(-1).values.push(99)]) {
    const changed = structuredClone(source); mutate(changed);
    assert.throws(() => assertLeagueData(changed), /differs/);
  }
  assert.throws(() => addLeagueClubComparison(prepareLeagueSource(fixture(), {slug:"fixture"}), {home:"בית"}), /every club/);
});

test("club graphics require their own evidence, a single rest baseline and nonoverlapping roles", () => {
  const source = addLeagueClubComparison(prepareLeagueSource(fixture(), {slug:"fixture"}), {home:"בית",away:"חוץ"});
  const make = () => {
    const a = authored(source);
    a.analysisPlan.graphics[0] = {...a.analysisPlan.graphics[0],type:"league_club_comparison",layout:"matrix",unit:"team_share",clubs:["home"],groups:["fullbacks","wing_forwards"],evidenceIds:["club.home.position.fullbacks","club.home.position.wing_forwards"]};
    return a;
  };
  let a=make();a.analysisPlan.graphics[0].clubs=["unknown"];
  assert.throws(()=>assertLeagueCopy(source,a),/graphic club/);
  a=make();a.analysisPlan.graphics[0].includeRest=true;
  assert.throws(()=>assertLeagueCopy(source,a),/rest evidence/);
  a=make();a.analysisPlan.graphics[0].groups=["fullbacks","left_back"];
  assert.throws(()=>assertLeagueCopy(source,a),/not overlap/);
});
