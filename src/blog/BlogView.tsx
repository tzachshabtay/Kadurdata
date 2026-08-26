import { useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Database,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { articles } from "../content/articles";
import type { ArticleShot, ContentArticle } from "../content/types";

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

function GoalTimeline({ article }: { article: ContentArticle }) {
  const goals = article.shots.filter((shot) => shot.outcome === "Goal");
  let homeScore = 0;
  let awayScore = 0;
  const plottedGoals = goals.map((shot) => {
    if (shot.teamId === article.teams.home.teamId) homeScore += 1;
    else awayScore += 1;
    return { ...shot, score: `${homeScore}:${awayScore}` };
  });

  return (
    <figure className="story-graphic story-timeline-graphic">
      <figcaption>
        <span>גרפיקה 01</span>
        <div><strong>המשחק החל בהפתעה — ואז החליף בעלים</strong><small>כל השערים על ציר הזמן, לפי אירועי המשחק</small></div>
      </figcaption>
      <div className="timeline-scroll">
        <div className="goal-timeline" dir="ltr">
          <span className="timeline-half">מחצית</span>
          <span className="timeline-label start">0׳</span>
          <span className="timeline-label end">90׳</span>
          {plottedGoals.map((goal, index) => (
            <div
              className={`timeline-goal ${index % 2 ? "below" : "above"}`}
              key={goal.eventId}
              style={{ left: `${Math.min(98, (goal.minute / 95) * 100)}%`, "--goal-color": goal.teamId === article.teams.home.teamId ? article.teams.home.color : article.teams.away.color } as CSSProperties}
            >
              <span className="timeline-dot" />
              <span className="timeline-goal-card"><b>{goal.score}</b><strong>{goal.playerNameHe}</strong><small>{goal.eventTime}</small></span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}

function ComparisonGraphic({ article }: { article: ContentArticle }) {
  const { home, away } = article.teams;
  const metrics = [
    { label: "שערים צפויים", home: home.stats.team_expected_goals, away: away.stats.team_expected_goals, max: 4, digits: 2 },
    { label: "בעיטות למסגרת", home: home.stats.team_shots_on_target, away: away.stats.team_shots_on_target, max: 10, digits: 0 },
    { label: "מצבים גדולים", home: home.stats.team_big_chances_created, away: away.stats.team_big_chances_created, max: 8, digits: 0 },
    { label: "xG למסגרת", home: home.stats.team_expected_goals_on_target, away: away.stats.team_expected_goals_on_target, max: 5, digits: 2 },
  ];
  return (
    <figure className="story-graphic comparison-graphic">
      <figcaption>
        <span>גרפיקה 02</span>
        <div><strong>אותו סדר גודל של בעיטות, עולם אחר של סיכוי</strong><small>{home.nameHe} באדום · {away.nameHe} בצהוב</small></div>
      </figcaption>
      <div className="comparison-grid">
        {metrics.map((metric) => (
          <div className="comparison-row" key={metric.label}>
            <strong className="comparison-home-value">{numeric(metric.home, metric.digits)}</strong>
            <div className="comparison-bars">
              <span className="comparison-track home"><i style={{ width: `${Math.min(100, (Number(metric.home) / metric.max) * 100)}%`, background: home.color }} /></span>
              <small>{metric.label}</small>
              <span className="comparison-track away"><i style={{ width: `${Math.min(100, (Number(metric.away) / metric.max) * 100)}%`, background: away.color }} /></span>
            </div>
            <strong className="comparison-away-value">{numeric(metric.away, metric.digits)}</strong>
          </div>
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
        <p>ארבע בעיטות הספיקו לשלושער. כל ארבע הבעיטות הלכו למסגרת.</p>
        <div className="spotlight-stats">
          <span><strong>{player.metrics.goals}</strong><small>שערים</small></span>
          <span><strong>{numeric(player.metrics.expected_goals, 2)}</strong><small>xG</small></span>
          <span><strong>{numeric(player.metrics.rating_365, 1)}</strong><small>ציון</small></span>
          <span><strong>{player.minutes}</strong><small>דקות</small></span>
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
        <span>גרפיקה 03</span>
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

function FactCheckPanel({ article }: { article: ContentArticle }) {
  return (
    <section className="fact-check-panel">
      <div className="fact-check-heading">
        <span className="fact-check-seal"><Check size={26} aria-hidden="true" /></span>
        <div><span>בדיקת כדורדאטה</span><h2>הכתבה עברה את כל {article.factCheck.checks.length} הבדיקות</h2><p>כל מספר בטקסט מקושר לשורת ראיות. סתירה אחת עוצרת את הפרסום.</p></div>
      </div>
      <div className="fact-check-list">
        {article.factCheck.checks.slice(0, 6).map((check) => (
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
  const article = articles.find((item) => item.slug === selectedSlug) ?? articles[0];
  if (!article) return <div className="story-empty">אין עדיין כתבות שעמדו בבדיקות הפרסום.</div>;
  const { editorial, match, teams } = article;

  return (
    <article className="story-page" dir="rtl">
      <header className="story-hero">
        <div className="story-hero-copy">
          <div className="story-kicker"><Sparkles size={15} aria-hidden="true" /> הסיפור של המשחק</div>
          <p className="story-meta">{match.competitionNameHe} · מחזור {match.roundNumber} · {hebrewDate.format(new Date(match.scheduledAt))}</p>
          <h1>{editorial.headline}</h1>
          <p className="story-dek">{editorial.dek}</p>
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

      <div className="story-body">
        <aside className="story-rail" aria-label="תקציר הכתבה">
          <span>ב־30 שניות</span>
          <ol>{editorial.takeaways.map((takeaway) => <li key={takeaway.text}>{takeaway.text}</li>)}</ol>
        </aside>

        <div className="story-main-copy">
          {editorial.sections.map((section, index) => (
            <div className="story-section-group" key={section.heading}>
              <section className="story-copy-section">
                <span className="section-number">0{index + 1}</span>
                <h2>{section.heading}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph.text}>{paragraph.text}</p>)}
              </section>
              {index === 0 && <GoalTimeline article={article} />}
              {index === 1 && <ComparisonGraphic article={article} />}
              {index === 2 && <DorSpotlight article={article} />}
              {index === 3 && <ShotMap article={article} />}
            </div>
          ))}

          <blockquote className="story-conclusion">{editorial.conclusion}</blockquote>
          <FactCheckPanel article={article} />

          <footer className="story-footer-cta">
            <div><span>רוצים לבדוק אותנו?</span><strong>כל שורת נתונים שמאחורי הכתבה מחכה בעמוד המשחק.</strong></div>
            <button type="button" onClick={() => onOpenMatch(article)}>פתחו את {teams.home.nameHe}–{teams.away.nameHe} <ArrowLeft size={17} aria-hidden="true" /></button>
          </footer>

          {articles.length > 1 && (
            <section className="story-archive">
              <span>עוד בכדורדאטה</span>
              <h2>כתבות אחרונות</h2>
              <div>{articles.filter((item) => item.slug !== article.slug).map((item) => (
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
  );
}
