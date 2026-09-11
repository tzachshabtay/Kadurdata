import type { LeagueAnalysisArticle, LeagueArticleGraphicSpec } from "../content/types";

const labels: Record<string,string> = {
  key_passes: "מסירות מפתח",
  total_shots: "בעיטות",
  passes_into_final_third: "מסירות לשליש האחרון",
};
const colors: Record<string,string> = { key_passes: "#3dc5b7", total_shots: "#efab55", passes_into_final_third: "#929eea" };

export function LeagueSummaryCard({ article }: { article: LeagueAnalysisArticle }) {
  return <aside className="story-score-card weekly-summary-card league-summary-card" aria-label="חלון ההשוואה">
    <span className="score-card-label">{article.period.competitionNameHe}</span>
    <strong className="weekly-summary-title">{article.playerComparison ? "המגנים השמאליים בהתקפה ובהגנה" : "תפקידים שונים, אותה ליגה"}</strong>
    <div className="score-card-insight">
      <span><small>משחקים</small><strong>{article.summary.matches}</strong></span>
      <span><small>קבוצות</small><strong>{article.summary.teams}</strong></span>
      <span><small>מחזורים</small><strong>{article.summary.rounds.length}</strong></span>
    </div>
    <p className="league-summary-note">{article.playerComparison ? "תרומה בהתקפה ובהגנה, בהשוואה לשחקנים באותה עמדה." : article.clubComparison ? "מי מוסר לפני הבעיטה, ומי בועט? התפקידים לפי העמדה הרשומה בכל הופעה." : "השוואה ל־90 דקות שחקן, לפי העמדה הרשומה בכל הופעה."}</p>
  </aside>;
}

export function LeaguePlayerGraphic({ article, spec }: { article: LeagueAnalysisArticle; spec: LeagueArticleGraphicSpec }) {
  const comparison = article.playerComparison;
  if (!comparison) return null;
  const players = (spec.playerIds ?? []).map(id => comparison.players.find(p => p.playerId === id)).filter(p => p !== undefined);
  const max = Object.fromEntries(spec.metrics.map(code => [code, Math.max(1, ...players.map(p => p.metrics[code].per90 ?? 0))]));
  return <figure className="story-graphic league-club-graphic league-player-graphic" aria-label={spec.titleHe}>
    <figcaption><div><strong>{spec.titleHe}</strong><small>{spec.subtitleHe}</small></div></figcaption>
    <div className="league-graphic-unit">ל־90 דקות שחקן · לפחות {comparison.scope.minimumMinutes} דקות בהופעות שסווגו בעמדת מגן שמאלי</div>
    <div className="league-club-metric">
      <div className="league-club-table-scroll" role="region" tabIndex={0} aria-label="השוואה אישית בין מגנים שמאליים">
        <table className="league-club-table league-player-table">
          <thead><tr><th scope="col">שחקן</th>{spec.metrics.map(code => <th scope="col" key={code}>{comparison.metricDefinitions[code].labelHe}</th>)}</tr></thead>
          <tbody>{players.map(p => <tr key={p.playerId} className={p.playerId === spec.highlightPlayerId ? "highlighted" : ""}>
            <th scope="row"><strong>{p.nameHe}</strong><small>{p.teamIds.map(id => article.clubComparison?.teamNames[id]).filter(Boolean).join(" / ")}</small><small>{p.minutes} דקות</small></th>
            {spec.metrics.map(code => {
              const metric = p.metrics[code];
              const negative = comparison.metricDefinitions[code].lowerIsBetter;
              return <td key={code} title={`${metric.total} פעולות ב־${p.minutes} דקות`}>
                <span className="league-club-cell" style={{background: `rgba(${negative ? "239, 171, 85" : "61, 197, 183"}, ${.06 + (metric.per90 ?? 0) / max[code] * .36})`}}><bdi>{metric.per90?.toFixed(2) ?? "-"}</bdi></span>
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    <p className="league-club-note">הדקות כוללות את ההופעה כולה לפי סיווג העמדה של הספק.{spec.metrics.includes("was_dribbled_past") ? " בעמודה ״עברו אותו בכדרור״ ערך נמוך יותר מציין פחות מקרים." : ""}</p>
  </figure>;
}

export function LeagueClubGraphic({ article, spec }: { article: LeagueAnalysisArticle; spec: LeagueArticleGraphicSpec }) {
  const clubs = (spec.clubs ?? []).map(id => article.clubComparison?.clubs.find(c => c.teamId === id)).filter(c => c !== undefined);
  const rows = clubs.flatMap(c => [{ id: c.teamId, label: c.labelHe, groups: c.groups }, ...(spec.includeRest ? [{ id: `rest:${c.teamId}`, label: "יתר הליגה", groups: c.rest.groups }] : [])]);
  const unit = spec.unit === "team_share" ? "teamShare" : "per90";
  const format = (value: number | null | undefined) => value == null ? "-" : spec.unit === "team_share" ? `${value.toFixed(1)}%` : value.toFixed(2);
  if (rows.length === 1) {
    const groups = spec.groups.map(id => rows[0].groups.find(g => g.id === id)).filter(g => g !== undefined);
    const scale = spec.unit === "team_share" ? 100 : Math.max(1, Math.ceil(Math.max(...groups.flatMap(g => spec.metrics.map(m => g.metrics[m][unit] ?? 0)))));
    return <figure className="story-graphic league-club-graphic" aria-label={spec.titleHe}>
      <figcaption><div><strong>{spec.titleHe}</strong><small>{spec.subtitleHe}</small></div></figcaption>
      <div className="league-graphic-unit">{rows[0].label} · {spec.unit === "team_share" ? "חלקה של העמדה בסך פעולות הקבוצה" : "ל־90 דקות שחקן"}</div>
      <div className="league-role-panels"><div className="league-role-panel">
        <div className="league-role-legend">{spec.metrics.map(m => <span key={m}><i style={{background: colors[m]}} />{labels[m]}</span>)}</div>
        {groups.map(g => <div className="league-role-group" key={g.id}><strong>{g.labelHe}</strong>{spec.metrics.map(m => <div className="league-role-bar-row" key={m} aria-label={`${g.labelHe}: ${format(g.metrics[m][unit])} ${labels[m]}`}>
          <span className="league-role-bar-track" aria-hidden="true"><i style={{width: `${(g.metrics[m][unit] ?? 0) / scale * 100}%`, background: colors[m]}} /></span><bdi>{format(g.metrics[m][unit])}</bdi>
        </div>)}</div>)}
        <div className="league-role-axis" aria-hidden="true"><bdi>0</bdi><bdi>{scale}{spec.unit === "team_share" ? "%" : ""}</bdi></div>
      </div></div>
      <p className="league-club-note">{spec.unit === "team_share" ? "האחוזים מחושבים מכל פעולות הקבוצה, גם בעמדות שאינן מוצגות." : "העמדות הן אלה שנרשמו בכל הופעה."}</p>
    </figure>;
  }
  return <figure className="story-graphic league-club-graphic" aria-label={spec.titleHe}>
    <figcaption><div><strong>{spec.titleHe}</strong><small>{spec.subtitleHe}</small></div></figcaption>
    <div className="league-graphic-unit">{spec.unit === "team_share" ? "חלקה של כל עמדה בסך הפעולות של קבוצתה" : "ל־90 דקות שחקן בעמדה"}</div>
    {spec.metrics.map(metric => {
      const max = Math.max(1, ...rows.flatMap(r => spec.groups.map(id => r.groups.find(g => g.id === id)?.metrics[metric]?.[unit] ?? 0)));
      return <div className="league-club-metric" key={metric}>
        <strong className="league-club-metric-title">{labels[metric]}</strong>
        <div className="league-club-table-scroll" tabIndex={0} role="region" aria-label={`${labels[metric]} לפי קבוצה ועמדה`}>
          <table className="league-club-table">
            <thead><tr><th scope="col">קבוצה</th>{spec.groups.map(id => <th scope="col" key={id}>{article.groups.find(g => g.id === id)?.labelHe}</th>)}</tr></thead>
            <tbody>{rows.map(row => <tr key={row.id} className={row.id === spec.highlightClubId ? "highlighted" : ""}>
              <th scope="row">{row.label}</th>
              {spec.groups.map(id => {
                const group = row.groups.find(g => g.id === id);
                const value = group?.metrics[metric]?.[unit];
                return <td key={id} title={`${group?.minutes ?? 0} דקות שחקן בעמדה`}>
                  <span className="league-club-cell" style={{ background: value == null ? undefined : `rgba(61, 197, 183, ${0.06 + value / max * .42})` }}><bdi>{format(value)}</bdi>{spec.groups.length === 1 && <small>{group?.minutes ?? 0} דקות</small>}</span>
                </td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
      </div>;
    })}
    <p className="league-club-note">{spec.unit === "team_share" ? "הצבע מדגיש את הערכים הגבוהים בכל מדד. האחוזים מחושבים מכל פעולות הקבוצה, גם בעמדות שאינן מוצגות." : "הצבע מדגיש את הערכים הגבוהים בכל מדד. מקף מציין שלא נרשמו דקות בעמדה."}{spec.includeRest ? " יתר הליגה מחושב ללא הקבוצה המוצגת." : ""}</p>
  </figure>;
}

export function LeagueRoleGraphic({ article, spec }: { article: LeagueAnalysisArticle; spec: LeagueArticleGraphicSpec }) {
  const groups = spec.groups.map(id => article.groups.find(g => g.id === id)).filter(g => g !== undefined);
  const panels = spec.layout === "panels" ? spec.metrics.map(m => [m]) : [spec.metrics];
  return <figure className="story-graphic league-role-graphic" aria-label={spec.titleHe}>
    <figcaption><div><strong>{spec.titleHe}</strong><small>{spec.subtitleHe}</small></div></figcaption>
    <div className="league-graphic-unit">ל־90 דקות שחקן</div>
    <div className={`league-role-panels ${spec.layout === "panels" ? "split" : ""}`}>
      {panels.map(metrics => {
        const largest = Math.max(0, ...groups.flatMap(g => metrics.map(m => g.metrics[m].per90)));
        const scale = Math.max(1, Math.ceil(largest * 2) / 2);
        return <div className="league-role-panel" key={metrics.join(":")}>
          <div className="league-role-legend">{metrics.map(m => <span key={m}><i style={{ background: colors[m] }} />{labels[m]}</span>)}</div>
          {groups.map(g => <div className="league-role-group" key={g.id}>
            <strong>{g.labelHe}</strong>
            {metrics.map(m => <div className="league-role-bar-row" key={m} aria-label={`${g.labelHe}: ${g.metrics[m].per90.toFixed(2)} ${labels[m]} ל־90 דקות שחקן`}>
              <span className="league-role-bar-track" aria-hidden="true"><i style={{ width: `${g.metrics[m].per90 / scale * 100}%`, background: colors[m] }} /></span>
              <bdi>{g.metrics[m].per90.toFixed(2)}</bdi>
            </div>)}
          </div>)}
          <div className="league-role-axis" aria-hidden="true"><bdi>0</bdi><bdi>{scale.toFixed(1)}</bdi></div>
        </div>;
      })}
    </div>
  </figure>;
}
