import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { blankStoryBrief, assertStoryBrief, assertStoryGate, assertStoredStoryGate, storyEvidenceHash } from "../scripts/content_story_gate.mjs";
import { buildReviewPacket, hashJson } from "../scripts/content_language_review.mjs";
import { stageCandidates } from "../scripts/preview_content_candidate.mjs";
import { reportingEvidence } from "../scripts/content_match_context.mjs";
import { matchPlayerRecapEvidence } from "../scripts/content_match_player_recaps.mjs";

const published = readdirSync(new URL('../src/content/generated/', import.meta.url)).filter(f=>f.endsWith('.json'))
  .map(f=>JSON.parse(readFileSync(new URL('../src/content/generated/'+f, import.meta.url))));
const maccabi = published.find(a=>a.slug==='ihoud-bnei-sakhnin-at-maccabi-tel-aviv-2026-10-10');

// Test-only assessments. Never saved into a real authored/reviewed package.
function storyFixture() {
  const a=structuredClone(maccabi);
  a.draftEditorial=null;
  a.analysisPlan.storyBrief={status:'ready',questionHe:'האם התיקו נבע רק מהחמצות?',answerHe:'מכבי התקשתה להגיע למצבים נוחים וגם החמיצה הזדמנויות אמיתיות.',tensionHe:'מבול הבעיטות לא הוביל לניצחון.',whyItMattersHe:'האחריות מתחלקת בין איכות המצבים לבין הסיומת.',evidenceIds:['mechanism.chance_creation','match.best_chances']};
  a.qualityReview.storyReview={status:'passed',briefHash:hashJson(a.analysisPlan.storyBrief),summaryHe:'ריבוי בעיטות הסתיר קושי ביצירה, אך לא זיכה את החלוצים מההחמצות.',explanationHe:'מיקום ואיכות הבעיטות לצד ההזדמנויות של החלוצים מבדילים בין יצירה לסיומת.',readerValueHe:'הקורא מבין מדוע עוד בעיטות לבדן לא היו הפתרון.',sectionProgression:a.editorial.sections.map((s,sectionIndex)=>({sectionIndex,addsHe:['מעמיד את השאלה מול ההקשר הקודם.','מפרט מי בעט ומאילו הזדמנויות.','בוחן את הבעיה בחלון הדומיננטי.','מציג הזדמנות שמונעת פטור למסיימים.'][sectionIndex]})),issues:[]};
  a.qualityReview.storyReview.reviewedContentHash=buildReviewPacket(a).storyContentHash;
  a.qualityReview.storyReview.evidenceHash=storyEvidenceHash(a.analysisPlan.storyBrief,a.evidence);
  return a;
}

test('missing or rejected premise stops before drafting, even with old story-value checks true',()=>{
  const unbriefed=structuredClone(maccabi);delete unbriefed.analysisPlan.storyBrief;
  assert.throws(()=>assertStoryGate(unbriefed,unbriefed.evidence),/pre-draft story brief/);
  assert.throws(()=>assertStoryBrief(blankStoryBrief(),maccabi.evidence),/rejected or unfinished/);
  const catalogue={status:'reject',questionHe:'מי מוסר ומי בועט?',answerHe:'קניקובסקי מוסר ופרץ בועט.',tensionHe:'חלוקת העבודה בקבוצה.',whyItMattersHe:'תפקידים שונים בהתקפה.',evidenceIds:['mechanism.chance_creation'],rejectionReasonHe:'תיאור תפקידים מוכרים בלי בעיית כדורגל או מסקנה שמוסיפה לקורא.'};
  assert.equal(maccabi.qualityReview.checks.storyValue,true);
  assert.throws(()=>assertStoryBrief(catalogue,maccabi.evidence),/תפקידים מוכרים/);
});

test('complete evidence-linked narrative handoff passes without changing visible review hashes',()=>{
  const a=storyFixture(),packet=buildReviewPacket(a);
  assert.doesNotThrow(()=>assertStoryGate(a,a.evidence));
  assert.equal(packet.storyBriefHash,hashJson(a.analysisPlan.storyBrief));
  assert.equal(packet.finalHash,maccabi.qualityReview.reviewedHash);
  assert.equal(packet.numberlessHash,maccabi.qualityReview.numberlessHash);
  assert.equal('storyBrief' in packet,false); // blind packet exposes the binding, not analyst conclusions.
});

test('blind rejection blocks an accurate package despite every legacy checkbox passing',()=>{
  const a=storyFixture();a.qualityReview.storyReview.status='failed';a.qualityReview.storyReview.issues=['הסעיפים חוזרים על התרשים ואינם מסבירים את התוצאה.'];
  assert.throws(()=>assertStoryGate(a,a.evidence),/blind reader/);
});

test('changed premise or visible copy requires renewed review',()=>{
  let a=storyFixture();a.analysisPlan.storyBrief.answerHe='הסבר אחר.';
  assert.throws(()=>assertStoryGate(a,a.evidence),/premise changed/);
  a=storyFixture();a.editorial.sections[0].paragraphs[0].text+=' טענה נוספת.';
  assert.throws(()=>assertStoryGate(a,a.evidence),/changed after review|exact final/);
});

test('review binds full graphic selectors as well as prose and captions',()=>{
  for(const mutate of [g=>g.metricCodes=['team_possession'],g=>g.focusPlayerId='another-player',g=>g.placementInsightId='another-section']){
    const a=storyFixture();mutate(a.analysisPlan.graphics[0]);
    assert.equal(buildReviewPacket(a).finalHash,maccabi.qualityReview.reviewedHash);
    assert.throws(()=>assertStoredStoryGate(a),/graphic selection changed/);
  }
});

test('a corrected decisive evidence payload under the same ID needs renewed review',()=>{
  const a=storyFixture();a.evidence.find(e=>e.id==='match.best_chances').context={correctedOutcome:'Saved'};
  assert.throws(()=>assertStoredStoryGate(a),/decisive evidence changed/);
});

test('missing, duplicate and invalid section assessments fail',()=>{
  for(const mutate of [r=>r.sectionProgression.pop(),r=>r.sectionProgression[1].sectionIndex=0,r=>r.sectionProgression[0].sectionIndex=99,r=>r.sectionProgression[0].addsHe='']){
    const a=storyFixture();mutate(a.qualityReview.storyReview);assert.throws(()=>assertStoryGate(a,a.evidence),/section|reader must/);
  }
});

test('a decisive citation must exist and actually support body copy',()=>{
  let a=storyFixture();a.analysisPlan.storyBrief.evidenceIds=['invented.evidence'];
  assert.throws(()=>assertStoryGate(a,a.evidence),/available evidence/);
  a=storyFixture();const used=new Set(a.editorial.sections.flatMap(s=>s.paragraphs.flatMap(p=>p.evidenceIds)));
  a.analysisPlan.storyBrief.evidenceIds=[a.evidence.find(e=>!used.has(e.id)).id];
  a.qualityReview.storyReview.briefHash=hashJson(a.analysisPlan.storyBrief);
  a.qualityReview.storyReview.reviewedContentHash=buildReviewPacket(a).storyContentHash;
  a.qualityReview.storyReview.evidenceHash=storyEvidenceHash(a.analysisPlan.storyBrief,a.evidence);
  assert.throws(()=>assertStoryGate(a,a.evidence),/article body/);
});

test('legacy published content retains its contract; versioned packages cannot drop the brief',()=>{
  for(const a of published)assert.doesNotThrow(()=>assertStoredStoryGate(a));
  const a=storyFixture();a.generation.storyGateVersion=1;assert.doesNotThrow(()=>assertStoredStoryGate(a));
  delete a.analysisPlan.storyBrief;assert.throws(()=>assertStoredStoryGate(a),/pre-draft/);
  a.generation.storyGateVersion=99;assert.throws(()=>assertStoredStoryGate(a),/unsupported/);
});

test('pre-draft CLI emits reproducible brief/evidence bindings and does not finalize copy',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'kadurdata-brief-'));
  try{
    const a=storyFixture();
    writeFileSync(path.join(dir,'source.json'),JSON.stringify({evidence:a.evidence}));
    writeFileSync(path.join(dir,'authored.json'),JSON.stringify({analysisPlan:a.analysisPlan}));
    const result=spawnSync(process.execPath,['scripts/content_story_gate.mjs','--source',path.join(dir,'source.json'),'--authored',path.join(dir,'authored.json')],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const handoff=JSON.parse(result.stdout);
    assert.equal(handoff.status,'ready_for_writer');
    assert.equal(handoff.storyBriefHash,a.qualityReview.storyReview.briefHash);
    assert.equal(handoff.evidenceHash,a.qualityReview.storyReview.evidenceHash);
    assert.equal(existsSync(path.join(dir,'candidate.json')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('match and weekly native finalizers reject unbriefed packages before writing a candidate',()=>{
  for(const [kind,script] of [['match_review','finalize_content_article.mjs'],['legionnaire_weekly','finalize_legionnaire_weekly_article.mjs']]){
    const dir=mkdtempSync(path.join(tmpdir(),'kadurdata-story-'));
    try{
      const source=structuredClone(published.filter(a=>a.kind===kind).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))[0]);source.generation.mode='codex_skill_workbench';
      const authored={...source,schemaVersion:2,source:'source.json'};
      delete authored.analysisPlan.storyBrief;
      writeFileSync(path.join(dir,'source.json'),JSON.stringify(source));writeFileSync(path.join(dir,'authored.json'),JSON.stringify(authored));
      const result=spawnSync(process.execPath,[`scripts/${script}`,'--source',path.join(dir,'source.json'),'--authored',path.join(dir,'authored.json')],{encoding:'utf8'});
      assert.equal(result.status,1);assert.match(result.stderr,/Story gate: a pre-draft story brief/);assert.equal(existsSync(path.join(dir,'candidate.json')),false);
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
});

test('context-enabled CLI binds the same completed player evidence as finalization',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'kadurdata-context-brief-'));
  try {
    const a=storyFixture(), reportingContext={sources:[{id:'match-report',publisher:'ynet',title:'דיווח',url:'https://www.ynet.co.il/example',phase:'after',publishedAt:'2026-10-10',accessedAt:'2026-10-21T10:00:00Z',facts:[{textHe:'המשחק הסתיים בתיקו.',values:[0]}]}]};
    const evidence=a.evidence.filter(e=>!e.id.startsWith('player.match.'));
    const source={evidence,players:a.players};
    const authored={analysisPlan:a.analysisPlan,playerRecaps:a.playerRecaps,reportingContext};
    writeFileSync(path.join(dir,'source.json'),JSON.stringify(source));writeFileSync(path.join(dir,'authored.json'),JSON.stringify(authored));
    const result=spawnSync(process.execPath,['scripts/content_story_gate.mjs','--source',path.join(dir,'source.json'),'--authored',path.join(dir,'authored.json')],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const combined=[...evidence,...reportingEvidence(reportingContext),...matchPlayerRecapEvidence(a.players)];
    assert.equal(JSON.parse(result.stdout).evidenceHash,storyEvidenceHash(a.analysisPlan.storyBrief,combined));
    const changed=structuredClone(combined);changed.find(e=>e.id.startsWith('player.match.')).values.push(999);
    assert.notEqual(JSON.parse(result.stdout).evidenceHash,storyEvidenceHash(a.analysisPlan.storyBrief,changed));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('a stale incoming preview preserves existing staged work even after a valid input',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'kadurdata-stage-'));
  try{
    const stage=path.join(dir,'review');
    const a=storyFixture();a.status='draft';a.approval.status='pending';a.generation.mode='codex_skill_candidate';a.generation.storyGateVersion=1;
    const file=path.join(dir,'candidate.json');writeFileSync(file,JSON.stringify(a));
    await stageCandidates([file],stage);
    const staged=path.join(stage,`${a.slug}.json`),original=readFileSync(staged,'utf8');
    a.analysisPlan.graphics[0].focusPlayerId='changed-player';
    const invalid=path.join(dir,'stale.json');writeFileSync(invalid,JSON.stringify(a));
    await assert.rejects(stageCandidates([file,invalid],stage),/graphic selection changed/);
    assert.equal(readFileSync(staged,'utf8'),original);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
