import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Database,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { articles } from "../content/articles";
import type { ArticleShot, ArticleTag, ContentArticle } from "../content/types";
import { renderSeasonHeatmap } from "../lib/seasonHeatmap";

type BlogViewProps = {
  onOpenMatch: (article: ContentArticle) => void;
};

const hebrewDate = new Intl.DateTimeFormat("he-IL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Jerusalem",
});

function numeric(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("he-IL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function goalLabel(shot: ArticleShot) {
  return `${shot.eventTime} · ${shot.playerNameHe}`;
}

function StoryScoreCard({ article }: { article: ContentArticle }) {
  const { home, away } = article.teams;
  return (
    <div className="story-score-card" aria-label={`${home.nameHe} ${home.score}, ${away.nameHe} ${away.score}`}>
      <span className="score-card-label">שריקת הסיום</span>
      <div className="score-card-teams">
        <div>
          {home.logoUrl ? <img className="score-card-logo" src={home.logoUrl} alt="" /> : <span className="score-card-crest hapoel">הפ׳</span>}
          <strong>{home.nameHe}</strong>
        </div>
        <div className="score-card-result"><strong>{home.score}</strong><i>:</i><strong>{away.score}</strong></div>
        <div>
          {away.logoUrl ? <img className="score-card-logo" src={away.logoUrl} alt="" /> : <span className="score-card-crest maccabi">מכ׳</span>}
          <strong>{away.nameHe}</strong>
        </div>
      </div>
      <div className="score-card-insight">
        <span><small>בעיטות</small><strong>{home.stats.team_total_shots}–{away.stats.team_total_shots}</strong></span>
        <span><small>xG</small><strong>{numeric(home.stats.team_expected_goals, 2)}–{numeric(away.stats.team_expected_goals, 2)}</strong></span>
        <span><small>מצבים גדולים</small><strong>{home.stats.team_big_chances_created}–{away.stats.team_big_chances_created}</strong></span>
      </div>
    </div>
  );
}

function MatchFlowGraphic({ article }: { article: ContentArticle }) {
  const { home, away } = article.teams;
  const maxXg = Math.max(0.1, ...article.flowWindows.flatMap((window) => [window.home.xg, window.away.xg]));
  const eventTypeHe: Record<string, string> = {
    Goal: "שער",
    Substitution: "חילוף",
    "Red Card": "אדום",
    "Yellow Card": "צהוב",
    Woodwork: "קורה",
  };
  return (
    <figure className="story-graphic match-flow-graphic">
      <figcaption>
        <div><strong>זרימת המשחק: האיום הגיע בגלים</strong><small>xG ובעיטות בכל חלון של 15 דקות · אירועי המפתח מתחת</small></div>
      </figcaption>
      <div className="flow-legend">
        <span><i style={{ background: home.color }} />{home.nameHe}</span>
        <span><i style={{ background: away.color }} />{away.nameHe}</span>
      </div>
      <div className="flow-windows" dir="ltr">
        {article.flowWindows.map((window) => {
          const events = article.timelineEvents.filter((event) => event.minute >= window.start && event.minute <= (window.end === 90 ? 105 : window.end));
          const substitutions = events.filter((event) => event.type === "Substitution").length;
          const highlighted = events.filter((event) => ["Goal", "Red Card", "Woodwork"].includes(event.type));
          return (
            <section className="flow-window" key={window.start}>
              <strong>{window.start}–{window.end}׳</strong>
              <div className="flow-bars">
                <span style={{ height: `${Math.max(3, window.home.xg / maxXg * 100)}%`, background: home.color }}><b>{numeric(window.home.xg, 2)}</b></span>
                <span style={{ height: `${Math.max(3, window.away.xg / maxXg * 100)}%`, background: away.color }}><b>{numeric(window.away.xg, 2)}</b></span>
              </div>
              <small>{window.home.shots}–{window.away.shots} בעיטות</small>
              <div className="flow-event-list" dir="rtl">
                {highlighted.map((event) => <i className={event.type === "Red Card" ? "red" : ""} key={event.id}>{event.eventTime} {eventTypeHe[event.type]}</i>)}
                {substitutions > 0 && <i>{substitutions} חילופים</i>}
              </div>
            </section>
          );
        })}
      </div>
      {article.actualPlayTime && (
        <div className="flow-playing-time">
          <span>זמן משחק נטו</span>
          <strong>{article.actualPlayTime.actual?.replace("Actual ", "") ?? "—"}</strong>
          <small>מתוך {article.actualPlayTime.total?.replace("Total ", "") ?? "—"} זמן כולל</small>
        </div>
      )}
    </figure>
  );
}

function HistoricalComparisonGraphic({ article }: { article: ContentArticle }) {
  const teams = [
    { team: article.teams.home, history: article.historicalContext.teams.home },
    { team: article.teams.away, history: article.historicalContext.teams.away },
  ];
  const metrics = [
    { code: "team_possession", label: "החזקה", suffix: "%", digits: 1 },
    { code: "team_total_shots", label: "בעיטות", suffix: "", digits: 1 },
    { code: "team_shots_on_target", label: "למסגרת", suffix: "", digits: 1 },
  ];
  return (
    <figure className="story-graphic history-comparison-graphic">
      <figcaption>
        <div><strong>מה השתנה לעומת 5 המשחקים הקודמים?</strong><small>בהיר: המשחק הנוכחי · כהה: הממוצע הקודם בכל המסגרות</small></div>
      </figcaption>
      <div className="history-comparison-grid">
        {teams.map(({ team, history }) => (
          <section key={team.teamId} style={{ "--history-color": team.color } as CSSProperties}>
            <header>
              {team.logoUrl && <img src={team.logoUrl} alt="" />}
              <div><strong>{team.nameHe}</strong><small>ממוצע {history.matchCount} משחקים קודמים</small></div>
            </header>
            {metrics.map((metric) => {
              const comparison = history.metrics[metric.code];
              if (!comparison) return null;
              const scale = Math.max(1, Number(comparison.current ?? 0), comparison.average);
              return (
                <div className="history-metric-row" key={metric.code}>
                  <div><span>{metric.label}</span><small>כעת <b>{numeric(comparison.current, metric.digits)}{metric.suffix}</b></small><small>קודם <b>{numeric(comparison.average, metric.digits)}{metric.suffix}</b></small></div>
                  <div className="history-metric-bars" dir="ltr">
                    <i className="baseline" style={{ width: `${comparison.average / scale * 100}%` }} />
                    <i className="current" style={{ width: `${Number(comparison.current ?? 0) / scale * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </figure>
  );
}

function DorSpotlight({ article }: { article: ContentArticle }) {
  const player = article.playerSpotlight.find((item) => item.name === "Dor Peretz");
  if (!player) return null;
  const teamGoals = article.teams.away.score;
  const share = Math.round((Number(player.metrics.goals) / teamGoals) * 100);
  return (
    <aside className="player-spotlight">
      <div className="spotlight-ring" style={{ "--goal-share": `${share * 3.6}deg` } as CSSProperties}>
        <span><strong>{share}%</strong><small>משערי מכבי</small></span>
      </div>
      <div className="spotlight-copy">
        <span className="spotlight-kicker">שחקן המשחק</span>
        <h3>דור פרץ</h3>
        <p>פרץ בעט 4 פעמים, כולן למסגרת. המצבים שמהם בעט היו שווים יחד {numeric(player.metrics.expected_goals, 2)} xG, והוא כבש 3 שערים.</p>
        <div className="spotlight-stats">
          <span><strong>{player.metrics.goals}</strong><small>שערים במשחק</small></span>
          <span><strong>{player.metrics.total_shots}</strong><small>בעיטות</small></span>
          <span><strong>{numeric(player.metrics.expected_goals, 2)}</strong><small>xG במשחק</small></span>
          <span><strong>{numeric(player.metrics.rating_365, 1)}</strong><small>ציון</small></span>
        </div>
      </div>
    </aside>
  );
}

function ShotMap({ article }: { article: ContentArticle }) {
  const outcomeHe: Record<string, string> = { Goal: "שער", Saved: "נעצרה", Missed: "החטאה", Blocked: "נחסמה" };
  return (
    <figure className="story-graphic shot-map-graphic">
      <figcaption>
        <div><strong>מפת הבעיטות: הגודל הוא הסיכוי</strong><small>{article.shots.length} בעיטות · כל הנקודות מכוונות לאותו שער להשוואה</small></div>
      </figcaption>
      <div className="article-shot-layout">
        <div className="article-shot-pitch" aria-label="מפת בעיטות">
          <span className="article-penalty-box" />
          <span className="article-six-yard-box" />
          <span className="article-goal" />
          <span className="article-penalty-spot" />
          {article.shots.map((shot) => {
            const size = Math.max(8, 8 + Math.sqrt(Math.max(0, shot.xg ?? 0)) * 20);
            const top = Math.max(3, Math.min(96, ((100 - shot.x) / 30) * 100));
            const left = Math.max(3, Math.min(97, shot.y));
            const isHome = shot.teamId === article.teams.home.teamId;
            return (
              <span
                aria-label={`${goalLabel(shot)}, ${outcomeHe[shot.outcome] ?? shot.outcome}, xG ${shot.xg}`}
                className={`article-shot ${shot.outcome === "Goal" ? "goal" : ""}`}
                key={shot.eventId}
                role="img"
                style={{
                  top: `${top}%`,
                  left: `${left}%`,
                  width: size,
                  height: size,
                  "--shot-color": isHome ? article.teams.home.color : article.teams.away.color,
                } as CSSProperties}
                tabIndex={0}
                title={`${goalLabel(shot)} · ${outcomeHe[shot.outcome] ?? shot.outcome} · xG ${shot.xg}`}
              />
            );
          })}
        </div>
        <div className="shot-map-legend">
          <span><i style={{ background: article.teams.home.color }} />{article.teams.home.nameHe}<strong>{article.teams.home.shotSummary.count}</strong></span>
          <span><i style={{ background: article.teams.away.color }} />{article.teams.away.nameHe}<strong>{article.teams.away.shotSummary.count}</strong></span>
          <small>עיגול גדול יותר = xG גבוה יותר · טבעת = שער</small>
        </div>
      </div>
    </figure>
  );
}

function TacticalHeatmapGraphic({ article }: { article: ContentArticle }) {
  const homeCanvas = useRef<HTMLCanvasElement>(null);
  const awayCanvas = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const starterIds = new Set(article.players.filter((player) => /start/i.test(player.lineupStatus ?? "")).map((player) => player.playerId));
    const homeRows = article.heatmaps.filter((row) => row.team_id === article.teams.home.teamId && starterIds.has(row.player_id));
    const awayRows = article.heatmaps.filter((row) => row.team_id === article.teams.away.teamId && starterIds.has(row.player_id));
    if (!homeCanvas.current || !awayCanvas.current) return () => controller.abort();
    setLoaded(false);
    Promise.all([
      renderSeasonHeatmap(homeCanvas.current, homeRows, controller.signal),
      renderSeasonHeatmap(awayCanvas.current, awayRows, controller.signal),
    ]).then(() => setLoaded(true)).catch(() => setLoaded(false));
    return () => controller.abort();
  }, [article]);

  return (
    <figure className="story-graphic tactical-heatmap-graphic">
      <figcaption>
        <div><strong>איפה נוצרה הצפיפות</strong><small>מפות החום המאוחדות של שחקני ההרכב · שתי הקבוצות תוקפות לאותו כיוון</small></div>
      </figcaption>
      <div className={`tactical-heatmap-grid${loaded ? " loaded" : ""}`} dir="ltr">
        <div><strong>{article.teams.home.nameHe}</strong><canvas ref={homeCanvas} /></div>
        <div><strong>{article.teams.away.nameHe}</strong><canvas ref={awayCanvas} /></div>
      </div>
    </figure>
  );
}

function FactCheckPanel({ article }: { article: ContentArticle }) {
  const visibleCheckIds = ["score-vs-events", "history-order", "historical-player-volume", "historical-coverage", "editorial-review", "evidence-links", "numeric-claims"];
  const visibleChecks = visibleCheckIds
    .map((id) => article.factCheck.checks.find((check) => check.id === id))
    .filter((check): check is ContentArticle["factCheck"]["checks"][number] => Boolean(check));
  return (
    <section className="fact-check-panel">
      <div className="fact-check-heading">
        <span className="fact-check-seal"><Check size={26} aria-hidden="true" /></span>
        <div><span>בדיקת כדורדאטה</span><h2>הכתבה עברה את כל {article.factCheck.checks.length} הבדיקות</h2><p>כל מספר בטקסט מקושר לשורת ראיות. סתירה אחת עוצרת את הפרסום.</p></div>
      </div>
      <div className="fact-check-list">
        {visibleChecks.map((check) => (
          <span key={check.id}><CheckCircle2 size={16} aria-hidden="true" /><strong>{check.label}</strong><small>{check.detail}</small></span>
        ))}
      </div>
      <div className="fact-check-meta">
        <span><Database size={15} aria-hidden="true" /> {article.factCheck.evidenceCount} חבילות ראיות</span>
        <span><ScanSearch size={15} aria-hidden="true" /> {article.factCheck.claimCount} טענות נבדקו</span>
        <span>נבדק: {hebrewDate.format(new Date(article.factCheck.checkedAt))}</span>
      </div>
    </section>
  );
}

export function BlogView({ onOpenMatch }: BlogViewProps) {
  const [selectedSlug, setSelectedSlug] = useState(articles[0]?.slug ?? "");
  const [activeTagId, setActiveTagId] = useState("");
  const filteredArticles = activeTagId
    ? articles.filter((item) => item.tags?.some((tag) => tag.id === activeTagId))
    : articles;
  const selectedArticle = articles.find((item) => item.slug === selectedSlug) ?? articles[0];
  const article = activeTagId && !selectedArticle?.tags?.some((tag) => tag.id === activeTagId)
    ? filteredArticles[0]
    : selectedArticle;
  if (!article) return <div className="story-empty">אין עדיין כתבות שעמדו בבדיקות הפרסום.</div>;
  const { editorial, match, teams } = article;
  const sectionEvidenceIds = editorial.sections.map((section) => new Set(section.paragraphs.flatMap((paragraph) => paragraph.evidenceIds)));
  const firstSectionUsing = (predicate: (evidenceId: string) => boolean) => sectionEvidenceIds.findIndex((ids) => [...ids].some(predicate));
  const flowGraphicIndex = firstSectionUsing((id) => id === "flow.shot_windows" || id.startsWith("timeline."));
  const historyGraphicIndex = firstSectionUsing((id) => id === "history.team.home" || id === "history.team.away");
  const spotlightGraphicIndex = firstSectionUsing((id) => id === "player.dor_peretz");
  const shotMapGraphicIndex = firstSectionUsing((id) => id === "match.shot_map" || id === "team.quality");
  const heatmapGraphicIndex = firstSectionUsing((id) => id === "heatmap.spatial_profile");
  const activeTag = articles.flatMap((item) => item.tags ?? []).find((tag) => tag.id === activeTagId);
  const filterByTag = (tag: ArticleTag) => {
    const nextTagId = activeTagId === tag.id ? "" : tag.id;
    setActiveTagId(nextTagId);
    if (nextTagId) {
      const firstMatch = articles.find((item) => item.tags?.some((itemTag) => itemTag.id === nextTagId));
      if (firstMatch) setSelectedSlug(firstMatch.slug);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="story-blog" dir="rtl">
      {activeTag && (
        <div className="story-filter-status" role="status">
          <span>מסנן לפי תגית: <strong>{activeTag.label}</strong> · {filteredArticles.length} כתבות</span>
          <button type="button" onClick={() => setActiveTagId("")}>הצג הכל</button>
        </div>
      )}
      <article className="story-page">
      <header className="story-hero">
        <div className="story-hero-copy">
          <div className="story-kicker"><Sparkles size={15} aria-hidden="true" /> הסיפור של המשחק</div>
          <p className="story-meta">{match.competitionNameHe} · מחזור {match.roundNumber} · {hebrewDate.format(new Date(match.scheduledAt))}</p>
          <h1>{editorial.headline}</h1>
          <p className="story-dek">{editorial.dek}</p>
          <div className="story-tags" aria-label="תגיות הכתבה">
            {article.tags.map((tag) => (
              <button aria-pressed={activeTagId === tag.id} key={tag.id} onClick={() => filterByTag(tag)} type="button">{tag.label}</button>
            ))}
          </div>
          <div className="story-byline">
            <span className="story-author-mark">KD</span>
            <span><strong>מערכת כדורדאטה</strong><small>נוצר מנתוני המשחק · נבדק לפני פרסום</small></span>
          </div>
        </div>
        <StoryScoreCard article={article} />
      </header>

      <div className="story-trust-strip">
        <span><CheckCircle2 size={16} aria-hidden="true" /> {article.factCheck.checks.length} בדיקות עובדתיות עברו</span>
        <span><Database size={16} aria-hidden="true" /> 365Scores דרך מאגר כדורדאטה</span>
        <button type="button" onClick={() => onOpenMatch(article)}>לכל נתוני המשחק <ArrowLeft size={15} aria-hidden="true" /></button>
      </div>

      <aside className="ai-disclaimer">
        <Sparkles size={17} aria-hidden="true" />
        <p><strong>גילוי נאות:</strong> {article.aiDisclosure.replace(/^גילוי נאות:\s*/, "")}</p>
      </aside>

      <div className="story-body">
        <aside className="story-rail" aria-label="תקציר הכתבה">
          <span>ב־30 שניות</span>
          <ol>{editorial.takeaways.map((takeaway) => <li key={takeaway.text}>{takeaway.text}</li>)}</ol>
        </aside>

        <div className="story-main-copy">
          {editorial.sections.map((section, index) => (
            <div className="story-section-group" key={section.heading}>
              <section className="story-copy-section">
                <h2>{section.heading}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph.text}>{paragraph.text}</p>)}
              </section>
              {index === flowGraphicIndex && <MatchFlowGraphic article={article} />}
              {index === historyGraphicIndex && <HistoricalComparisonGraphic article={article} />}
              {index === spotlightGraphicIndex && <DorSpotlight article={article} />}
              {index === shotMapGraphicIndex && <ShotMap article={article} />}
              {index === heatmapGraphicIndex && <TacticalHeatmapGraphic article={article} />}
            </div>
          ))}

          <blockquote className="story-conclusion">{editorial.conclusion}</blockquote>
          <FactCheckPanel article={article} />

          <footer className="story-footer-cta">
            <div><span>רוצים לבדוק אותנו?</span><strong>כל שורת נתונים שמאחורי הכתבה מחכה בעמוד המשחק.</strong></div>
            <button type="button" onClick={() => onOpenMatch(article)}>פתחו את {teams.home.nameHe}–{teams.away.nameHe} <ArrowLeft size={17} aria-hidden="true" /></button>
          </footer>

          {filteredArticles.length > 1 && (
            <section className="story-archive">
              <span>עוד בכדורדאטה</span>
              <h2>{activeTag ? `עוד תחת התגית ${activeTag.label}` : "כתבות אחרונות"}</h2>
              <div>{filteredArticles.filter((item) => item.slug !== article.slug).map((item) => (
                <button key={item.slug} type="button" onClick={() => { setSelectedSlug(item.slug); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                  <small>{item.match.competitionNameHe} · {hebrewDate.format(new Date(item.match.scheduledAt))}</small>
                  <strong>{item.editorial.headline}</strong>
                  <i>לקריאה <ArrowLeft size={14} aria-hidden="true" /></i>
                </button>
              ))}</div>
            </section>
          )}
        </div>
      </div>
      </article>
    </div>
  );
}
