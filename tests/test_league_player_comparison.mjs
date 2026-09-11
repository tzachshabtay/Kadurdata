import test from "node:test";
import assert from "node:assert/strict";
import { prepareLeagueSource, addLeaguePlayerComparison, assertLeagueData, assertLeagueCopy } from "../scripts/content_league_analysis.mjs";
import { PLAYER_COMPARISON_METRICS } from "../scripts/content_league_player_comparison.mjs";

function fixture() {
  const matches = [0,1,2].map(i => ({match_id:`m${i}`,competition_id:"league",competition_name:"Israeli Premier League",season_id:"season",season_name:"2026/2027",scheduled_at:`2026-09-0${i+1}T16:00:00Z`,status:"Ended",round_number:i+1,home_team_id:"home",away_team_id:"away"}));
  const apps = matches.flatMap((m,i) => [
    {appearance_id:`home${i}`,player_id:"creator",team_id:"home",match_id:m.match_id,formation_position:i===2?"Right Back":"Left Back",minutes_played:90},
    {appearance_id:`away${i}`,player_id:i===2?"brief":"peer",team_id:"away",match_id:m.match_id,formation_position:"Left Back",minutes_played:90},
  ]);
  const players = apps.flatMap(a => ["key_passes","total_shots","passes_into_final_third"].map(code => ({...a,metric_code:code,value_numeric:a.appearance_id==='home2'?99:2})));
  const source=prepareLeagueSource({matches,players},{slug:"comparison-fixture"});
  const defenseCodes=Object.entries(PLAYER_COMPARISON_METRICS).filter(([,m])=>m.family==='defense').map(([code])=>code);
  const raw={snapshotHash:source.snapshotHash,queriedAt:"2026-09-04T00:00:00Z",players:apps.filter(a=>a.formation_position==='Left Back').flatMap(a=>defenseCodes.map(code=>({...a,source_code:"365scores",metric_code:code,value_numeric:code==='interceptions'?0:a.player_id==='creator'?4:2})))};
  const names={creator:"יוצר",peer:"עמית",brief:"מחליף"};
  return {source,raw,names};
}

test("individual rates use only matching-role appearances, and rest excludes focal and brief players",()=>{
  const {source,raw,names}=fixture(); const result=addLeaguePlayerComparison(source,raw,names);
  const p=result.playerComparison.players.find(p=>p.playerId==='creator');
  assert.equal(p.minutes,180); assert.equal(p.metrics.key_passes.total,4); assert.equal(p.metrics.key_passes.per90,2);
  assert.equal(p.metrics.ball_recovery.per90,4); assert.equal(p.metrics.interceptions.per90,0);
  assert.equal(result.playerComparison.scope.eligiblePlayers,2);
  const rest=result.playerComparison.rests.find(r=>r.playerId==='creator');
  assert.equal(rest.players,1);assert.equal(rest.minutes,180);assert.equal(rest.metrics.ball_recovery.per90,2);
  assert.equal(source.playerComparison,undefined);assert.equal(result.snapshotHash,source.snapshotHash);
  assert.doesNotThrow(()=>assertLeagueData(result));
});

test("absent defense values, duplicate rows and changed source minutes are rejected",()=>{
  for(const mutate of [r=>r.players.pop(),r=>r.players.push(r.players[0]),r=>r.players[0].minutes_played=89,r=>r.players[0].value_numeric=null]){
    const {source,raw,names}=fixture(); mutate(raw);
    assert.throws(()=>addLeaguePlayerComparison(source,raw,names),/Missing defensive|Duplicate|differs|Invalid defensive/);
  }
});

test("supplement and derived defense values are bound by source validation",()=>{
  const {source,raw,names}=fixture();const original=addLeaguePlayerComparison(source,raw,names);
  const inputChanged=structuredClone(original);inputChanged.playerComparison.input.rows[0].value=99;
  assert.throws(()=>assertLeagueData(inputChanged),/supplement hash changed/);
  const derivedChanged=structuredClone(original);derivedChanged.playerComparison.players[0].metrics.ball_recovery.per90=99;
  assert.throws(()=>assertLeagueData(derivedChanged),/differs/);
  const evidenceChanged=structuredClone(original);evidenceChanged.evidence.at(-1).values.push(99);
  assert.throws(()=>assertLeagueData(evidenceChanged),/differs/);
});

test("comparison charts cannot promote short appearances or omit their evidence",()=>{
  const {source,raw,names}=fixture();const s=addLeaguePlayerComparison(source,raw,names);
  const claim={text:"המגן תרם להתקפה.",evidenceIds:['peer.creator']};
  const a={kind:'league_analysis',authorship:{analystAgentId:'fixture:a',writerAgentId:'fixture:w',editorAgentId:'fixture:e',reviewerAgentId:'fixture:r'},aiDisclosure:'בינה מלאכותית',editorial:{headline:claim.text,headlineEvidenceIds:claim.evidenceIds,dek:claim.text,dekEvidenceIds:claim.evidenceIds,sections:['a','b','c'].map(id=>({heading:id,insightIds:[id],paragraphs:[claim]})),takeaways:[claim,claim,claim],conclusion:claim.text,conclusionEvidenceIds:claim.evidenceIds},analysisPlan:{thesis:'תפקיד',rankedInsights:['a','b','c'].map(id=>({id,evidenceIds:claim.evidenceIds})),graphics:['a','b'].map(id=>({id,type:'league_player_comparison',layout:'matrix',unit:'per90',titleHe:'השוואת מגנים',subtitleHe:'לפי דקות ההופעות',placementInsightId:id,playerIds:['creator','brief'],highlightPlayerId:'creator',metrics:['ball_recovery'],evidenceIds:['peer.scope','peer.creator','peer.brief']}))}};
  assert.throws(()=>assertLeagueCopy(s,a),/eligible peers/);
  a.analysisPlan.graphics[0].playerIds=['creator','peer'];
  assert.throws(()=>assertLeagueCopy(s,a),/missing evidence/);
});
