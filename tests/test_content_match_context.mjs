import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchContext, matchContextEvidence, reportingEvidence, assertContextUse, usedReportingSources } from '../scripts/content_match_context.mjs';
import { buildReviewPacket } from '../scripts/content_language_review.mjs';
import { storyEvidenceHash } from '../scripts/content_story_gate.mjs';

const fixture = (id, date, home, away, hs, as, extras = {}) => ({ match_id: id, scheduled_at: date, competition_id: 'league', season_id: 'season', status: 'Ended', home_team_id: home, away_team_id: away, home_team_name: home, away_team_name: away, home_score: hs, away_score: as, ...extras });
const selected = fixture('current', '2026-10-19T17:30:00Z', 'beitar', 'maccabi', 0, 0);
const report = () => ({ sources: [{ id: 'ynet', publisher: 'ynet', title: 'דיווח המשחק', url: 'https://www.ynet.co.il/example', phase: 'live', publishedAt: '2026-10-19', accessedAt: '2026-10-21T10:00:00Z', facts: [{ textHe: 'פרץ בעט והכדור הורחק מקו השער.', values: [89] }] }], novelty: { pressSummaryHe: 'הדיווח עסק בהחמצות.', addedInsightHe: 'היתרון המאוחר לא נשען רק על הניסיון האחרון.', dataEvidenceIds: ['match.shots'] } });

test('freezes same-league form and standings before kickoff, applying only the selected result afterward', () => {
  const rows = [fixture('prior', '2026-10-10T17:00:00Z', 'maccabi', 'beitar', 2, 1), fixture('future', '2026-10-20T17:00:00Z', 'beitar', 'maccabi', 9, 0), fixture('cup', '2026-10-11T17:00:00Z', 'beitar', 'maccabi', 9, 0, { competition_id: 'cup' }), fixture('old-season', '2026-09-10T17:00:00Z', 'beitar', 'maccabi', 9, 0, { season_id: 'other' }), fixture('overlap', '2026-10-19T17:00:00Z', 'beitar', 'maccabi', 9, 0), fixture('scheduled', '2026-10-11T17:00:00Z', 'beitar', 'maccabi', null, null, { status: 'Scheduled' })];
  const c = buildMatchContext(selected, rows);
  assert.deepEqual(c.priorMatches.map(m => m.match_id), ['prior']);
  assert.equal(c.before.find(t => t.teamId === 'maccabi').points, 3);
  assert.equal(c.afterSelectedResult.find(t => t.teamId === 'maccabi').points, 4);
  assert.equal(c.recentForm.home.matches[0].goalsFor, 1);
  assert.equal(c.recentForm.home.matches[0].home, false);
  assert.equal(c.recentForm.away.matches[0].result, 'W');
});

test('normalizes opponent and score orientation and uses only the latest five prior league fixtures', () => {
  const rows = Array.from({ length: 7 }, (_, i) => fixture(`prior-${i}`, `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00Z`, i % 2 ? 'beitar' : 'maccabi', i % 2 ? 'maccabi' : 'beitar', 2, 0));
  const c = buildMatchContext(selected, rows), f = c.recentForm.home;
  assert.deepEqual(f.matches.map(m => m.matchId), ['prior-2', 'prior-3', 'prior-4', 'prior-5', 'prior-6']);
  assert.equal(f.played, 5); assert.equal(f.won, 2); assert.equal(f.lost, 3);
  assert.throws(() => buildMatchContext(selected, [...rows, rows[0]]), /duplicate fixture/);
  assert.throws(() => buildMatchContext(selected, [{ ...rows[0], home_score: null }]), /invalid completed score/);
});

test('context and reporting corrections under unchanged citation IDs invalidate evidence bindings', () => {
  const c = buildMatchContext(selected, [fixture('prior', '2026-10-10T17:00:00Z', 'maccabi', 'beitar', 2, 1)]);
  const evidence = [{ id: 'match.shots', values: [1], context: {} }, ...matchContextEvidence(c), ...reportingEvidence(report())];
  const brief = { evidenceIds: ['match.shots'] }, before = storyEvidenceHash(brief, evidence);
  const changed = structuredClone(evidence); changed.find(e => e.id === 'context.table').context.before[0].points++;
  assert.notEqual(storyEvidenceHash(brief, changed), before);
  const changedReport = structuredClone(evidence); changedReport.at(-1).context.url = 'https://www.ynet.co.il/changed';
  assert.notEqual(storyEvidenceHash(brief, changedReport), before);
});

test('attribution labels are reviewed and URLs/provenance cannot change after the final-copy hash', () => {
  const a = { schemaVersion: 2, draftEditorial: null, editorial: { headline: 'שאלה', sections: [{ heading: 'סעיף', paragraphs: [{ text: 'הסבר', evidenceIds: ['context.reporting.ynet'] }] }] }, analysisPlan: { graphics: [] }, playerRecaps: [], reportingContext: report() };
  const before = buildReviewPacket(a);
  assert(before.sentences.some(s => s.location === 'reportingSources.0.publisher.sentence.0' && s.text === 'ynet'));
  a.reportingContext.sources[0].url = 'https://www.ynet.co.il/changed';
  assert.notEqual(buildReviewPacket(a).finalHash, before.finalHash);
  a.reportingContext.sources[0].url = 'javascript:alert(1)';
  assert.throws(() => reportingEvidence(a.reportingContext), /HTTPS/);
});

test('context supports a native analytical insight rather than replacing it with press interpretation', () => {
  const a = { editorial: { sections: [{ paragraphs: [{ text: 'הסבר', evidenceIds: ['context.table', 'context.reporting.ynet', 'match.shots'] }] }] }, reportingContext: report() };
  const evidence = [{ id: 'context.table' }, { id: 'match.shots' }];
  assert.doesNotThrow(() => assertContextUse(a, evidence));
  a.reportingContext.novelty.dataEvidenceIds = ['context.table'];
  assert.throws(() => assertContextUse(a, evidence), /native match evidence/);
});

test('added insight and historical fixture provenance invalidate review even outside the brief', () => {
  const c = buildMatchContext(selected, [fixture('prior', '2026-10-10T17:00:00Z', 'maccabi', 'beitar', 2, 1)]);
  const native = [{ id: 'brief', values: [1] }, { id: 'extra-insight', values: [2] }], brief = { evidenceIds: ['brief'] };
  const before = storyEvidenceHash(brief, [...native, ...matchContextEvidence(c)]);
  const changed = structuredClone(native); changed[1].values = [999];
  assert.notEqual(storyEvidenceHash(brief, [...changed, ...matchContextEvidence(c)]), before);
  c.priorMatches[0].match_id = 'different-fixture';
  assert.notEqual(storyEvidenceHash(brief, [...native, ...matchContextEvidence(c)]), before);
});

test('nonleague finalizations require reporting and native novelty without a synthetic league table', () => {
  const a = { editorial: { sections: [{ paragraphs: [{ evidenceIds: ['context.reporting.ynet', 'match.shots'] }] }] }, reportingContext: report() };
  assert.doesNotThrow(() => assertContextUse(a, [{ id: 'match.shots' }], { required: true }));
  delete a.reportingContext;
  assert.throws(() => assertContextUse(a, [{ id: 'match.shots' }], { required: true }), /attribute/);
});

test('report links and reviewed labels include citations outside body paragraphs once per source', () => {
  const editorial = { headline: 'כותרת', sections: [], conclusion: 'סיכום', conclusionEvidenceIds: ['context.reporting.ynet'] };
  assert.equal(usedReportingSources(editorial, report()).length, 1);
  const packet = buildReviewPacket({ schemaVersion: 2, draftEditorial: null, editorial, reportingContext: report(), analysisPlan: { graphics: [] } });
  assert.equal(packet.sentences.filter(s => s.location.startsWith('reportingSources.')).length, 1);
});
