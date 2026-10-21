// Context is reconstructed at the fixture's kickoff, never from today's table.
// Reporting supplies attributable background; the analyst still derives insights
// from match data and the blind reader independently checks the source pages.
const terminal = new Set(['Ended', 'After ET', 'After Penalties']);
const ensure = (condition, message) => { if (!condition) throw Error(`Match context: ${message}`); };
const numbers = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(numbers);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbers);
  return [];
};
const item = (id, label, rows, context, sourceView = 'api_matches') => ({ id, label, sourceView, sourceRows: rows, values: [...new Set(numbers(context))], context });

function table(matches) {
  const teams = new Map();
  for (const m of matches) for (const side of ['home', 'away']) {
    const other = side === 'home' ? 'away' : 'home', id = m[`${side}_team_id`];
    const t = teams.get(id) ?? { teamId: id, nameHe: m[`${side}_team_name_he`] || m[`${side}_team_name`], played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
    const gf = m[`${side}_score`], ga = m[`${other}_score`];
    t.played++; t.goalsFor += gf; t.goalsAgainst += ga;
    if (gf > ga) { t.won++; t.points += 3; } else if (gf === ga) { t.drawn++; t.points++; } else t.lost++;
    t.goalDifference = t.goalsFor - t.goalsAgainst; teams.set(id, t);
  }
  const rows = [...teams.values()].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.teamId.localeCompare(b.teamId));
  rows.forEach((t, i) => {
    const equal = i > 0 && t.points === rows[i - 1].points && t.goalDifference === rows[i - 1].goalDifference && t.goalsFor === rows[i - 1].goalsFor;
    t.position = equal ? rows[i - 1].position : i + 1;
    t.tied = rows.some(x => x !== t && x.points === t.points && x.goalDifference === t.goalDifference && x.goalsFor === t.goalsFor);
  });
  return rows;
}

export function buildMatchContext(match, leagueMatches) {
  const kickoff = Date.parse(match.scheduled_at);
  ensure(Number.isFinite(kickoff), 'invalid kickoff');
  const seen = new Set();
  const previous = leagueMatches.filter(m => {
    if (m.match_id === match.match_id || m.competition_id !== match.competition_id || m.season_id !== match.season_id || !terminal.has(m.status)) return false;
    // No completion timestamps are available. Exclude overlapping kickoffs
    // rather than treating a game that could still be live as a prior result.
    if (!Number.isFinite(Date.parse(m.scheduled_at)) || Date.parse(m.scheduled_at) + 120 * 60000 > kickoff) return false;
    ensure(!seen.has(m.match_id), 'duplicate fixture'); seen.add(m.match_id);
    ensure(Number.isInteger(m.home_score) && m.home_score >= 0 && Number.isInteger(m.away_score) && m.away_score >= 0, 'invalid completed score');
    return true;
  }).sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || a.match_id.localeCompare(b.match_id));
  const recentForm = Object.fromEntries(['home', 'away'].map(side => {
    const teamId = match[`${side}_team_id`];
    const matches = previous.filter(m => [m.home_team_id, m.away_team_id].includes(teamId)).slice(-5).map(m => {
      const home = m.home_team_id === teamId, gf = home ? m.home_score : m.away_score, ga = home ? m.away_score : m.home_score;
      return { matchId: m.match_id, scheduledAt: m.scheduled_at, opponentTeamId: home ? m.away_team_id : m.home_team_id, opponentNameHe: (home ? m.away_team_name_he : m.home_team_name_he) || (home ? m.away_team_name : m.home_team_name), home, goalsFor: gf, goalsAgainst: ga, result: gf > ga ? 'W' : gf === ga ? 'D' : 'L' };
    });
    return [side, { teamId, matches, played: matches.length, won: matches.filter(m => m.result === 'W').length, drawn: matches.filter(m => m.result === 'D').length, lost: matches.filter(m => m.result === 'L').length, goalsFor: matches.reduce((s, m) => s + m.goalsFor, 0), goalsAgainst: matches.reduce((s, m) => s + m.goalsAgainst, 0) }];
  }));
  return { asOf: match.scheduled_at, competitionId: match.competition_id, seasonId: match.season_id, priorMatches: previous, before: table(previous), afterSelectedResult: table([...previous, match]), recentForm,
    qualificationHe: 'טבלה משוחזרת מתוצאות ליגה שהושלמו לפי המאגר; ללא הפחתות נקודות או הכרעות שוברי שוויון מעבר להפרש ושערי זכות. משחקים שהחלו פחות משעתיים לפני השריקה הושמטו בהיעדר חותמת סיום. תמונת אחרי מחילה רק את תוצאת המשחק הנבחר. יש לאמת מיקום רשמי לפני שימוש בו.' };
}

export function matchContextEvidence(context) {
  if (!context) return [];
  return [item('context.table', 'מצב הליגה לפני המשחק ואחרי תוצאתו', context.priorMatches.length, { asOf: context.asOf, competitionId: context.competitionId, seasonId: context.seasonId, priorMatches: context.priorMatches, before: context.before, afterSelectedResult: context.afterSelectedResult, qualificationHe: context.qualificationHe }),
    ...['home', 'away'].map(side => item(`context.form.${side}`, 'חמשת משחקי הליגה הקודמים', context.recentForm[side].matches.length, context.recentForm[side]))];
}

export function withMatchContextEvidence(evidence, context) {
  if (!context) return evidence;
  const derived = matchContextEvidence(context), ids = new Set(derived.map(e => e.id));
  return [...evidence.filter(e => !ids.has(e.id)), ...derived];
}

export function reportingEvidence(reporting) {
  if (!reporting) return [];
  ensure(Array.isArray(reporting.sources) && reporting.sources.length > 0, 'reporting sources missing');
  const seen = new Set();
  return reporting.sources.map(source => {
    ensure(typeof source.id === 'string' && /^[a-z0-9_-]+$/.test(source.id) && !seen.has(source.id), 'invalid or duplicate reporting source ID'); seen.add(source.id);
    const url = new URL(source.url);
    ensure(url.protocol === 'https:' && !url.username && !url.password, 'reporting link must be public HTTPS');
    ensure(['before', 'live', 'after'].includes(source.phase), 'reporting phase missing');
    ensure(source.publisher?.trim() && source.title?.trim() && source.publishedAt?.trim() && Number.isFinite(Date.parse(source.accessedAt)), 'reporting provenance missing');
    ensure(Array.isArray(source.facts) && source.facts.length && source.facts.every(f => f.textHe?.trim() && Array.isArray(f.values) && f.values.every(Number.isFinite)), 'reporting facts need text and explicit numeric values');
    return item(`context.reporting.${source.id}`, source.title, source.facts.length, source, source.url);
  });
}

export function usedReportingSources(editorial, reporting) {
  const ids = new Set([...(editorial?.headlineEvidenceIds ?? []), ...(editorial?.dekEvidenceIds ?? []), ...(editorial?.sections ?? []).flatMap(s => s.paragraphs.flatMap(p => p.evidenceIds ?? [])), ...(editorial?.takeaways ?? []).flatMap(t => t.evidenceIds ?? []), ...(editorial?.conclusionEvidenceIds ?? [])]);
  return (reporting?.sources ?? []).filter(s => ids.has(`context.reporting.${s.id}`));
}

export function assertContextUse(authored, evidence, { required = false } = {}) {
  const hasTable = evidence.some(e => e.id === 'context.table');
  if (!required && !hasTable && !authored.reportingContext) return;
  const bodyIds = new Set(authored.editorial.sections.flatMap(s => s.paragraphs.flatMap(p => p.evidenceIds)));
  if (hasTable) ensure([...bodyIds].some(id => /^context\.(table|form\.)/.test(id)), 'the article must use relevant table/form context');
  reportingEvidence(authored.reportingContext);
  ensure(usedReportingSources(authored.editorial, authored.reportingContext).length > 0, 'the article must attribute the reporting context it uses');
  const novelty = authored.reportingContext?.novelty;
  ensure(novelty?.pressSummaryHe?.trim() && novelty?.addedInsightHe?.trim() && Array.isArray(novelty?.dataEvidenceIds) && novelty.dataEvidenceIds.length > 0, 'record what the data adds beyond the reporting');
  const known = new Set(evidence.map(e => e.id));
  ensure(novelty.dataEvidenceIds.every(id => !id.startsWith('context.') && known.has(id) && bodyIds.has(id)), 'the added insight needs native match evidence used in the body');
}
