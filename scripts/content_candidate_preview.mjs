function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function numeric(value, digits = 0) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("he-IL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

function rgbFromHex(value) {
  const normalized = String(value ?? "").trim().replace(/^#/, "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((character) => character.repeat(2)).join("")
    : normalized;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
}

function colorDistance(left, right) {
  const leftRgb = rgbFromHex(left);
  const rightRgb = rgbFromHex(right);
  if (!leftRgb || !rightRgb) return Number.POSITIVE_INFINITY;
  return Math.hypot(...leftRgb.map((channel, index) => channel - rightRgb[index]));
}

function teamColors(article) {
  const home = article.teams.home.color || "#e9435d";
  const requestedAway = article.teams.away.color || "#2bbf9b";
  if (colorDistance(home, requestedAway) >= 100) return { home, away: requestedAway };
  const options = ["#2bbf9b", "#3b82f6", "#f4b942", "#a78bfa"];
  const away = options.sort((left, right) => colorDistance(home, right) - colorDistance(home, left))[0];
  return { home, away };
}

function graphicFrame(spec, body) {
  return `<figure class="graphic">
    <figcaption><strong>${escapeHtml(spec.titleHe)}</strong><small>${escapeHtml(spec.subtitleHe)}</small></figcaption>
    ${body}
  </figure>`;
}

function matchFlowGraphic(article, spec, colors) {
  const maxXg = Math.max(0.1, ...article.flowWindows.flatMap((window) => [window.home.xg, window.away.xg]));
  const windows = article.flowWindows.map((window) => {
    const events = article.timelineEvents.filter((event) => event.minute >= window.start && event.minute <= window.end);
    const eventCopy = events
      .filter((event) => ["Goal", "Red Card", "Woodwork"].includes(event.type))
      .map((event) => `${escapeHtml(event.eventTime)} ${event.type === "Goal" ? "שער" : event.type === "Red Card" ? "אדום" : "קורה"}`)
      .join(" · ");
    return `<div class="flow-window">
      <b>${window.start}–${window.end}׳</b>
      <div class="flow-bars">
        <i style="height:${Math.max(4, window.home.xg / maxXg * 100)}%;background:${colors.home}"><span>${numeric(window.home.xg, 2)}</span></i>
        <i style="height:${Math.max(4, window.away.xg / maxXg * 100)}%;background:${colors.away}"><span>${numeric(window.away.xg, 2)}</span></i>
      </div>
      <small>${window.home.shots}–${window.away.shots} בעיטות</small>
      ${eventCopy ? `<em>${eventCopy}</em>` : ""}
    </div>`;
  }).join("");
  return graphicFrame(spec, `<div class="legend"><span><i style="background:${colors.home}"></i>${escapeHtml(article.teams.home.nameHe)}</span><span><i style="background:${colors.away}"></i>${escapeHtml(article.teams.away.nameHe)}</span></div><div class="flow-grid" dir="ltr">${windows}</div>`);
}

function shotMapGraphic(article, spec, colors) {
  const shots = article.shots.map((shot) => {
    const size = Math.max(8, 8 + Math.sqrt(Math.max(0, shot.xg ?? 0)) * 22);
    const top = Math.max(3, Math.min(96, ((100 - shot.x) / 30) * 100));
    const left = Math.max(3, Math.min(97, shot.y));
    const color = shot.teamId === article.teams.home.teamId ? colors.home : colors.away;
    const title = `${shot.eventTime} · ${shot.playerNameHe} · xG ${shot.xg}`;
    return `<i class="shot${shot.outcome === "Goal" ? " goal" : ""}" title="${escapeHtml(title)}" style="top:${top}%;left:${left}%;width:${size}px;height:${size}px;background:${color}"></i>`;
  }).join("");
  return graphicFrame(spec, `<div class="shot-layout"><div class="shot-pitch"><span class="penalty-box"></span><span class="six-box"></span><span class="goal-box"></span>${shots}</div><div class="legend vertical"><span><i style="background:${colors.home}"></i>${escapeHtml(article.teams.home.nameHe)} — ${article.teams.home.shotSummary.count}</span><span><i style="background:${colors.away}"></i>${escapeHtml(article.teams.away.nameHe)} — ${article.teams.away.shotSummary.count}</span><small>עיגול גדול יותר = xG גבוה יותר · טבעת = שער</small></div></div>`);
}

function spatialPitch(team, profile, color) {
  const players = (profile?.players ?? []).map((player) => `<i class="position-dot" title="${escapeHtml(player.nameHe)}" style="left:${player.y}%;bottom:${player.x}%;background:${color}"><span>${escapeHtml(player.nameHe.split(" ").at(-1))}</span></i>`).join("");
  return `<section class="position-team"><strong>${escapeHtml(team.nameHe)}</strong><div class="position-pitch">${players}</div></section>`;
}

function tacticalGraphic(article, spec, colors) {
  return graphicFrame(spec, `<div class="position-grid" dir="ltr">${spatialPitch(article.teams.home, article.spatialProfile.home, colors.home)}${spatialPitch(article.teams.away, article.spatialProfile.away, colors.away)}</div>`);
}

function plannedGraphic(article, spec, colors) {
  if (spec.type === "match_flow") return matchFlowGraphic(article, spec, colors);
  if (spec.type === "shot_map") return shotMapGraphic(article, spec, colors);
  if (spec.type === "tactical_heatmap") return tacticalGraphic(article, spec, colors);
  return graphicFrame(spec, "<p class=\"graphic-note\">הגרפיקה תוצג ברכיב המלא לאחר אישור הפרסום.</p>");
}

function articleSections(article, colors) {
  return article.editorial.sections.map((section) => {
    const paragraphs = section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph.text)}</p>`).join("");
    const graphics = article.analysisPlan.graphics
      .filter((graphic) => section.insightIds.includes(graphic.placementInsightId))
      .map((graphic) => plannedGraphic(article, graphic, colors))
      .join("");
    return `<section class="article-section"><h2>${escapeHtml(section.heading)}</h2>${paragraphs}${graphics}</section>`;
  }).join("");
}

function renderCandidatePreview(article) {
  if (article.status !== "draft" || article.approval?.status !== "pending") {
    throw new Error("Preview accepts only an unpublished candidate awaiting approval.");
  }
  const colors = teamColors(article);
  const date = new Intl.DateTimeFormat("he-IL", { dateStyle: "long", timeZone: "Asia/Jerusalem" }).format(new Date(article.match.scheduledAt));
  const tags = article.tags.map((tag) => `<span>${escapeHtml(tag.label)}</span>`).join("");
  const takeaways = article.editorial.takeaways.map((item) => `<li>${escapeHtml(item.text)}</li>`).join("");
  const logos = [article.teams.home, article.teams.away].map((team) => team.logoUrl ? `<img src="${escapeHtml(team.logoUrl)}" alt="">` : "");
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline';">
  <title>${escapeHtml(article.editorial.headline)} · תצוגה לאישור</title>
  <style>
    :root{color-scheme:dark;--bg:#08110f;--panel:#101b18;--line:#263a35;--text:#f5f7f6;--muted:#a5b4af;--green:#2bbf9b}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#17332b 0,#08110f 34rem);color:var(--text);font-family:Arial,"Noto Sans Hebrew",sans-serif;line-height:1.75}
    main{width:min(940px,calc(100% - 28px));margin:0 auto;padding:30px 0 80px}.review-bar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;gap:16px;padding:12px 18px;margin-bottom:30px;border:1px solid #55645f;background:#17211fdd;backdrop-filter:blur(12px);border-radius:14px}.review-bar strong{color:#ffd166}.review-bar small{color:var(--muted)}
    .hero{padding:28px 0 10px}.eyebrow{color:var(--green);font-weight:800;letter-spacing:.08em}.disclosure{margin:20px 0;padding:14px 16px;border-right:4px solid var(--green);background:#10231e;border-radius:10px;color:#dce7e3}.hero h1{font-size:clamp(2.2rem,6vw,4.7rem);line-height:1.02;margin:.2em 0}.dek{font-size:1.25rem;color:#d8e1de;max-width:800px}.meta{color:var(--muted)}.tags{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.tags span{border:1px solid #31564b;color:#bff3e5;padding:4px 11px;border-radius:999px;font-size:.9rem}
    .score{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:20px;background:linear-gradient(135deg,#121f1b,#0e1715);border:1px solid var(--line);padding:24px;border-radius:20px;margin:28px 0}.team{display:flex;align-items:center;gap:12px;font-weight:800}.team:last-child{justify-content:flex-end}.team img{width:54px;height:54px;object-fit:contain}.result{font-size:2.6rem;font-weight:900;direction:ltr}
    .article-section{padding:28px 0;border-top:1px solid var(--line)}.article-section h2{font-size:1.8rem;line-height:1.25;margin:0 0 12px}.article-section p{font-size:1.08rem;margin:0 0 16px;color:#eef2f0}.graphic{margin:28px 0;padding:20px;border:1px solid var(--line);background:var(--panel);border-radius:18px;overflow:hidden}.graphic figcaption{display:flex;flex-direction:column;margin-bottom:18px}.graphic figcaption strong{font-size:1.2rem}.graphic figcaption small{color:var(--muted)}
    .legend{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0 15px}.legend.vertical{flex-direction:column}.legend span{display:flex;align-items:center;gap:7px}.legend i{width:10px;height:10px;border-radius:50%}.legend small{color:var(--muted)}
    .flow-grid{display:grid;grid-template-columns:repeat(8,minmax(70px,1fr));gap:8px;overflow-x:auto}.flow-window{min-width:70px;text-align:center}.flow-bars{height:132px;display:flex;align-items:flex-end;justify-content:center;gap:6px;border-bottom:1px solid #4a5c56;margin:8px 0}.flow-bars i{display:block;width:23px;min-height:4px;border-radius:5px 5px 0 0;position:relative}.flow-bars i span{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);font-style:normal;font-size:.7rem}.flow-window small,.flow-window em{display:block;font-size:.72rem;color:var(--muted);font-style:normal}
    .shot-layout{display:grid;grid-template-columns:minmax(260px,1fr) 220px;gap:22px}.shot-pitch,.position-pitch{position:relative;min-height:390px;background:linear-gradient(90deg,#173f31 0 50%,#1b4938 50%);border:2px solid #d9efe7;border-radius:4px;overflow:hidden}.shot-pitch:after,.position-pitch:after{content:"";position:absolute;left:50%;top:0;bottom:0;border-left:1px solid #d9efe777}.penalty-box,.six-box,.goal-box{position:absolute;left:50%;transform:translateX(-50%);border:1px solid #d9efe7;border-top:0}.penalty-box{top:0;width:58%;height:38%}.six-box{top:0;width:30%;height:18%}.goal-box{top:0;width:14%;height:5%}.shot{position:absolute;transform:translate(-50%,-50%);border-radius:50%;opacity:.84;border:1px solid #fff}.shot.goal{outline:3px solid #fff;opacity:1}
    .position-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.position-team>strong{display:block;text-align:center;margin-bottom:8px}.position-dot{position:absolute;width:14px;height:14px;border:2px solid white;border-radius:50%;transform:translate(-50%,50%);z-index:2}.position-dot span{position:absolute;left:50%;top:14px;transform:translateX(-50%);font-style:normal;font-size:.62rem;white-space:nowrap;text-shadow:0 1px 3px #000}
    .summary{margin-top:28px;padding:24px;border:1px solid #2e5449;background:#10231e;border-radius:18px}.summary h2{margin-top:0}.summary li{margin-bottom:9px}.conclusion{font-size:1.15rem;font-weight:700}.checks{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px;color:#bff3e5}.checks span{border:1px solid #31564b;padding:5px 10px;border-radius:8px}
    @media(max-width:720px){.review-bar{position:static;flex-direction:column}.score{grid-template-columns:1fr}.team,.team:last-child{justify-content:center}.result{text-align:center}.shot-layout,.position-grid{grid-template-columns:1fr}.flow-grid{grid-template-columns:repeat(8,78px)}.hero h1{font-size:2.55rem}}
  </style>
</head>
<body><main>
  <div class="review-bar"><strong>טיוטה לאישור · אינה מפורסמת בבלוג</strong><small>מזהה גרסה: ${escapeHtml(article.qualityReview.reviewedHash?.slice(0, 12) ?? "—")}</small></div>
  <header class="hero"><span class="eyebrow">KADURDATA · ${escapeHtml(article.match.competitionNameHe)}</span><p class="disclosure">${escapeHtml(article.aiDisclosure)}</p><h1>${escapeHtml(article.editorial.headline)}</h1><p class="dek">${escapeHtml(article.editorial.dek)}</p><p class="meta">${escapeHtml(date)}</p><div class="tags">${tags}</div></header>
  <section class="score"><div class="team">${logos[0]}<span>${escapeHtml(article.teams.home.nameHe)}</span></div><div class="result">${article.teams.home.score} : ${article.teams.away.score}</div><div class="team"><span>${escapeHtml(article.teams.away.nameHe)}</span>${logos[1]}</div></section>
  <article>${articleSections(article, colors)}</article>
  <section class="summary"><h2>שלוש נקודות לסיכום</h2><ol>${takeaways}</ol><p class="conclusion">${escapeHtml(article.editorial.conclusion)}</p><div class="checks"><span>${article.factCheck.checks.length} בדיקות עובדתיות עברו</span><span>${article.qualityReview.sentenceReviews.length} משפטים עברו ביקורת</span><span>ממתינה לאישור שלך</span></div></section>
</main></body></html>`;
}

export { renderCandidatePreview };
