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
    <strong className="weekly-summary-title">תפקידים שונים, אותה ליגה</strong>
    <div className="score-card-insight">
      <span><small>משחקים</small><strong>{article.summary.matches}</strong></span>
      <span><small>קבוצות</small><strong>{article.summary.teams}</strong></span>
      <span><small>מחזורים</small><strong>{article.summary.rounds.length}</strong></span>
    </div>
    <p className="league-summary-note">השוואה ל־90 דקות שחקן, לפי העמדה הרשומה בכל הופעה.</p>
  </aside>;
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
