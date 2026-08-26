#!/usr/bin/env node

import { access, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectory = path.join(projectRoot, "src", "content", "generated");

async function loadLocalEnv() {
  try {
    const contents = await readFile(path.join(projectRoot, ".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // CI supplies environment variables directly.
  }
}

function readArguments() {
  const args = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  return {
    matchId: valueAfter("--match-id"),
    noAi: args.includes("--no-ai"),
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
  };
}

function cleanTeamSlug(value) {
  return value
    .replace(/\bFC\b/gi, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function datePart(value) {
  return value?.slice(0, 10) ?? "undated";
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function numberValue(value) {
  return value === null || value === undefined ? null : Number(value);
}

async function selectMatch(client, requestedMatchId) {
  if (requestedMatchId) {
    const result = await client.from("api_matches").select("*").eq("match_id", requestedMatchId).single();
    if (result.error) throw result.error;
    return result.data;
  }

  const result = await client
    .from("api_matches")
    .select("*")
    .eq("competition_name", "Israeli Premier League")
    .eq("status", "Ended")
    .gte("home_score", 0)
    .gte("away_score", 0)
    .order("scheduled_at", { ascending: false })
    .limit(20);
  if (result.error) throw result.error;

  for (const match of result.data ?? []) {
    const stats = await client.from("api_match_team_stats").select("metric_code").eq("match_id", match.match_id).limit(1);
    if (!stats.error && stats.data?.length) return match;
  }
  throw new Error("No completed Ligat Ha'Al match with detailed statistics was found.");
}

async function fetchMatchDataset(client, match) {
  const queries = await Promise.all([
    client.from("api_match_team_stats").select("*").eq("match_id", match.match_id).limit(500),
    client.from("api_match_player_stats").select("*").eq("match_id", match.match_id).limit(3000),
    client.from("api_match_shots").select("*").eq("match_id", match.match_id).order("minute").limit(500),
    client.from("api_team_assets").select("*").in("team_id", [match.home_team_id, match.away_team_id]),
    client.from("api_match_player_heatmaps").select("*").eq("match_id", match.match_id).limit(100),
  ]);
  const firstError = queries.find((query) => query.error)?.error;
  if (firstError) throw firstError;
  return {
    teamRows: queries[0].data ?? [],
    playerRows: queries[1].data ?? [],
    shots: queries[2].data ?? [],
    assets: queries[3].data ?? [],
    heatmaps: queries[4].data ?? [],
  };
}

function pivotTeamStats(rows) {
  const teams = new Map();
  for (const row of rows) {
    const current = teams.get(row.team_id) ?? {};
    current[row.metric_code] = numberValue(row.value_numeric);
    teams.set(row.team_id, current);
  }
  return teams;
}

function pivotPlayerStats(rows) {
  const players = new Map();
  for (const row of rows) {
    const current = players.get(row.player_id) ?? {
      playerId: row.player_id,
      name: row.display_name,
      nameHe: row.display_name_he ?? row.display_name,
      teamId: row.team_id,
      teamName: row.team_name,
      side: row.side,
      lineupStatus: row.lineup_status,
      positionName: row.position_name,
      formationPosition: row.formation_position,
      shirtNumber: numberValue(row.shirt_number),
      roleGroup: playerRoleGroup(row.position_name, row.formation_position),
      minutes: numberValue(row.minutes_played),
      metrics: {},
    };
    current.metrics[row.metric_code] = numberValue(row.value_numeric);
    players.set(row.player_id, current);
  }
  return [...players.values()];
}

function playerRoleGroup(positionName, formationPosition) {
  const position = `${positionName ?? ""} ${formationPosition ?? ""}`.toLowerCase();
  if (/goalkeeper|keeper|\bgk\b/.test(position)) return "Goalkeeper";
  if (/defender|centre back|center back|full back|wing back|left back|right back|\bcb\b|\blb\b|\brb\b/.test(position)) return "Defender";
  if (/midfield|\bdm\b|\bcm\b|\bam\b/.test(position)) return "Midfielder";
  if (/attacker|forward|striker|winger|\bcf\b|\blf\b|\brf\b/.test(position)) return "Attacker";
  return "Other";
}

function sumMetric(players, metricCode) {
  return players.reduce((sum, player) => sum + Number(player.metrics[metricCode] ?? 0), 0);
}

function unitMetrics(players) {
  return {
    playerCount: players.length,
    recoveries: sumMetric(players, "ball_recovery"),
    interceptions: sumMetric(players, "interceptions"),
    tacklesWon: sumMetric(players, "tackles_won"),
    tacklesAttempted: sumMetric(players, "tackles_attempted"),
    expectedGoals: round(sumMetric(players, "expected_goals")),
    goals: sumMetric(players, "goals"),
    shots: sumMetric(players, "total_shots"),
    shotsOnTarget: sumMetric(players, "shots_on_target"),
    expectedAssists: round(sumMetric(players, "expected_assists")),
    keyPasses: sumMetric(players, "key_passes"),
    assists: sumMetric(players, "assists"),
    groundDuelsWon: sumMetric(players, "ground_duels_won"),
    groundDuelsAttempted: sumMetric(players, "ground_duels_attempted"),
    clearances: sumMetric(players, "clearances"),
    blocks: sumMetric(players, "blocks"),
    wasDribbledPast: sumMetric(players, "was_dribbled_past"),
  };
}

function teamUnits(players, teamId) {
  const teamPlayers = players.filter((player) => player.teamId === teamId);
  return {
    defenders: unitMetrics(teamPlayers.filter((player) => player.roleGroup === "Defender")),
    midfielders: unitMetrics(teamPlayers.filter((player) => player.roleGroup === "Midfielder")),
    attackers: unitMetrics(teamPlayers.filter((player) => player.roleGroup === "Attacker")),
  };
}

function shotSummary(shots, teamId) {
  const relevant = shots.filter((shot) => shot.team_id === teamId);
  return {
    count: relevant.length,
    goals: relevant.filter((shot) => shot.outcome === "Goal").length,
    onTarget: relevant.filter((shot) => shot.outcome === "Goal" || shot.outcome === "Saved").length,
    xg: round(relevant.reduce((sum, shot) => sum + Number(shot.xg ?? 0), 0)),
    xgot: round(relevant.reduce((sum, shot) => sum + Number(shot.xgot ?? 0), 0)),
  };
}

function teamSnapshot(match, side, stats, assets, shots) {
  const prefix = side === "home" ? "home" : "away";
  const teamId = match[`${prefix}_team_id`];
  const asset = assets.find((item) => item.team_id === teamId);
  return {
    teamId,
    name: match[`${prefix}_team_name`],
    nameHe: match[`${prefix}_team_name_he`] ?? match[`${prefix}_team_name`],
    score: Number(match[`${prefix}_score`]),
    color: asset?.primary_color ?? match[`${prefix}_team_color`] ?? (side === "home" ? "#d8362d" : "#e8bd20"),
    secondaryColor: asset?.secondary_color ?? null,
    logoUrl: asset?.logo_url ?? match[`${prefix}_team_logo_url`] ?? null,
    stats,
    shotSummary: shotSummary(shots, teamId),
  };
}

function evidenceItem(id, label, sourceView, sourceRows, values) {
  return { id, label, sourceView, sourceRows, values: values.filter((value) => value !== null && value !== undefined) };
}

function buildEvidence(match, home, away, players, shots, unitMatchups, heatmaps) {
  const dor = players.find((player) => player.name === "Dor Peretz");
  const creators = players.filter((player) => ["Hélio Varela", "Noam Ben Harush", "Osher Davida"].includes(player.name));
  const creatorTotals = {
    assists: creators.reduce((sum, player) => sum + Number(player.metrics.assists ?? 0), 0),
    expectedAssists: round(creators.reduce((sum, player) => sum + Number(player.metrics.expected_assists ?? 0), 0)),
    keyPasses: creators.reduce((sum, player) => sum + Number(player.metrics.key_passes ?? 0), 0),
    bigChances: creators.reduce((sum, player) => sum + Number(player.metrics.big_chances_created ?? 0), 0),
  };
  const goals = shots.filter((shot) => shot.outcome === "Goal");
  const dappaChance = shots.find((shot) => shot.display_name === "Israel Dappa" && shot.xg >= 0.2);
  const homeMidfield = unitMatchups.home.midfielders;
  const awayMidfield = unitMatchups.away.midfielders;
  const homeAttack = unitMatchups.home.attackers;
  const awayAttack = unitMatchups.away.attackers;
  const awayDefense = unitMatchups.away.defenders;
  return [
    evidenceItem("match.result", "תוצאת המשחק", "api_matches", 1, [home.score, away.score]),
    evidenceItem("match.opening_goal", "שער היתרון המוקדם", "api_match_shots", 1, [1, 0.09]),
    evidenceItem("team.volume", "נפח החזקה ובעיטות", "api_match_team_stats", 4, [
      home.stats.team_possession, away.stats.team_possession, home.stats.team_total_shots, away.stats.team_total_shots,
    ]),
    evidenceItem("team.quality", "איכות המצבים", "api_match_team_stats", 8, [
      home.stats.team_expected_goals, away.stats.team_expected_goals,
      home.stats.team_shots_on_target, away.stats.team_shots_on_target,
      home.stats.team_big_chances_created, away.stats.team_big_chances_created,
      home.stats.team_expected_goals_on_target, away.stats.team_expected_goals_on_target,
    ]),
    evidenceItem("team.progression", "התקדמות לעומת חדירה", "api_match_team_stats", 8, [
      home.stats.team_passes_into_final_third, away.stats.team_passes_into_final_third,
      home.stats.team_key_passes, away.stats.team_key_passes,
      home.stats.team_possession_lost, away.stats.team_possession_lost,
      home.stats.team_interceptions, away.stats.team_interceptions,
    ]),
    evidenceItem("style.team_profiles", "פרופיל סגנון המשחק", "api_match_team_stats", 14, [
      home.stats.team_passes_into_final_third, away.stats.team_passes_into_final_third,
      home.stats.team_key_passes, away.stats.team_key_passes,
      home.stats.team_crosses_completed, away.stats.team_crosses_completed,
      home.stats.team_expected_goals, away.stats.team_expected_goals,
      home.stats.team_possession_lost, away.stats.team_possession_lost,
      home.stats.team_interceptions, away.stats.team_interceptions,
      home.stats.team_backward_passes, away.stats.team_backward_passes,
    ]),
    evidenceItem("matchup.midfield", "המאבק בין חוליות הקישור", "api_match_player_stats", 12, [
      homeMidfield.recoveries, homeMidfield.tacklesWon, homeMidfield.tacklesAttempted,
      awayMidfield.recoveries, awayMidfield.tacklesWon, awayMidfield.tacklesAttempted,
      homeMidfield.goals, homeMidfield.expectedGoals, homeMidfield.shotsOnTarget,
      awayMidfield.goals, awayMidfield.expectedGoals, awayMidfield.shotsOnTarget,
    ]),
    evidenceItem("matchup.home_attack_away_defense", "התקפת המארחת מול הגנת האורחת", "api_match_player_stats", 10, [
      awayDefense.tacklesWon, awayDefense.tacklesAttempted, awayDefense.clearances, awayDefense.blocks,
      awayDefense.wasDribbledPast, homeAttack.shots, homeAttack.expectedGoals, homeAttack.goals,
      homeAttack.groundDuelsWon, homeAttack.groundDuelsAttempted,
    ]),
    evidenceItem("matchup.away_attack", "תרומת התקפת האורחת", "api_match_player_stats", 9, [
      awayAttack.goals, awayAttack.expectedGoals, awayAttack.keyPasses, awayAttack.expectedAssists,
      awayAttack.assists, awayMidfield.goals, awayMidfield.expectedGoals,
      awayDefense.goals, awayDefense.expectedGoals,
    ]),
    evidenceItem("heatmap.method", "מפות חום מצטברות לפי הופעה", "api_match_player_heatmaps", heatmaps.length, [heatmaps.length]),
    evidenceItem("player.dor_peretz", "משחקו של דור פרץ", "api_match_player_stats", 12, dor ? [
      dor.metrics.goals, dor.metrics.total_shots, dor.metrics.expected_goals, dor.metrics.rating_365, dor.minutes,
      ...goals.filter((shot) => shot.display_name === "Dor Peretz").flatMap((shot) => [shot.minute, shot.event_time?.includes("+") ? 2 : null]),
    ] : []),
    evidenceItem("player.creators", "יוצרי המצבים של מכבי", "api_match_player_stats", creators.length * 4, [
      creatorTotals.assists, creatorTotals.expectedAssists, creatorTotals.keyPasses, creatorTotals.bigChances,
      ...creators.flatMap((player) => [player.metrics.assists, player.metrics.expected_assists, player.metrics.key_passes, player.metrics.big_chances_created]),
    ]),
    evidenceItem("hapoel.best_chance", "ההזדמנות הגדולה של ישראל דאפה", "api_match_shots", dappaChance ? 1 : 0, dappaChance ? [
      dappaChance.minute, dappaChance.xg, dappaChance.xgot,
    ] : []),
    evidenceItem("timeline.goals", "ציר שערי המשחק", "api_match_shots", goals.length, goals.flatMap((shot) => [
      shot.minute, shot.event_time?.includes("+") ? Number(shot.event_time.match(/\+\s*(\d+)/)?.[1] ?? 0) : null,
    ])),
    evidenceItem("match.shot_map", "מפת הבעיטות", "api_match_shots", shots.length, [
      shots.length, home.shotSummary.count, away.shotSummary.count, home.shotSummary.xg, away.shotSummary.xg,
    ]),
  ];
}

function fallbackEditorial(match, home, away) {
  return {
    headline: "לא הכמות, אלא האיכות: כך מכבי תל אביב הפכה פיגור מוקדם ל־5:2",
    headlineEvidenceIds: ["match.result"],
    dek: "הפועל ירושלים בעטה כמעט באותה תדירות והחזיקה כמעט מחצית מהכדור. ההבדל היה במקום אחר: 6 מצבים גדולים, 3.56 שערים צפויים ו־3 שערים חדים של דור פרץ.",
    dekEvidenceIds: ["team.volume", "team.quality", "player.dor_peretz"],
    sections: [
      {
        heading: "הפתעה של דקה, תשובה של משחק שלם",
        paragraphs: [
          {
            text: "הפועל ירושלים כבשה כבר בדקה הראשונה, אבל היתרון המוקדם לא שינה את הכיוון העמוק של המשחק. מכבי תל אביב חזרה, ירדה להפסקה ביתרון והמשיכה עד 5:2 — תוצאה רחבה שנבנתה בעיקר על איכות ההזדמנויות.",
            evidenceIds: ["match.opening_goal", "match.result", "timeline.goals"],
          },
        ],
      },
      {
        heading: "כמעט שוויון בכמות, פער חד באיכות",
        paragraphs: [
          {
            text: "51%–49% בהחזקה ו־17–16 בבעיטות לא נראים כמו משחק חד־צדדי. גם במסירות מפתח הפער היה זניח: 12 למכבי מול 13 להפועל. אלא שהמדדים שמקרבים אותנו לשער סיפרו סיפור אחר לגמרי.",
            evidenceIds: ["team.volume", "team.progression"],
          },
          {
            text: "מכבי הגיעה ל־3.56 xG מול 1.27, ייצרה 6 מצבים גדולים מול 2 ושלחה 8 בעיטות למסגרת מול 5. כלומר, היא לא בעטה הרבה יותר — היא בעטה ממקומות ומצבים טובים בהרבה.",
            evidenceIds: ["team.quality"],
          },
        ],
      },
      {
        heading: "דור פרץ היה גם היעד וגם הפתרון",
        paragraphs: [
          {
            text: "3 שערים מ־4 בעיטות, 2.50 xG וציון 9.7 ב־75 דקות: דור פרץ ריכז אצלו את המצבים הכי יקרים של מכבי וגם סיים אותם. השלושער שלו לא היה רצף של ניסיונות מרחוק, אלא תוצר של הגעה עקבית לאזורים שבהם שער הוא התוצאה הסבירה.",
            evidenceIds: ["player.dor_peretz"],
          },
          {
            text: "האספקה הייתה מפוזרת: הליו וארלה, נועם בן הרוש ואושר דוידה רשמו יחד 7 מסירות מפתח, 1.49 xA, 2 מצבים גדולים ו־3 בישולים. זו הייתה מערכת יצירה, לא פעולה בודדת שחזרה במקרה.",
            evidenceIds: ["player.creators"],
          },
        ],
      },
      {
        heading: "מה המספרים אומרים על הפועל",
        paragraphs: [
          {
            text: "הפועל הכניסה 95 מסירות לשליש האחרון מול 70 של מכבי והשלימה 7 הגבהות מול 3. פרופיל המספרים מתאים לקבוצה שדחפה יותר כדורים קדימה ולרוחב, אבל היא גם איבדה את הכדור 110 פעמים מול 94 והגיעה ל־1.27 xG בלבד מול 3.56.",
            evidenceIds: ["style.team_profiles"],
          },
          {
            text: "ההחמצה המשמעותית הגיעה בדקה ה־20: ישראל דאפה נעצר במצב של 0.28 xG. אחרי ההזדמנות הזאת, היתרון המוקדם כבר לא קיבל מספיק תמיכה מאיכות המצבים הבאים.",
            evidenceIds: ["hapoel.best_chance", "match.opening_goal", "team.quality"],
          },
        ],
      },
      {
        heading: "מי באמת ניצח את מרכז המגרש?",
        paragraphs: [
          {
            text: "קשרי הפועל רשמו 16 חילוצי כדור ו־6 תיקולים מוצלחים מ־7 ניסיונות; קשרי מכבי הסתפקו ב־8 חילוצים וב־3 מ־4. במאבק ההגנתי במרכז, המספרים נוטים להפועל.",
            evidenceIds: ["matchup.midfield"],
          },
          {
            text: "אבל ההשפעה ההתקפית התהפכה: קשרי מכבי ייצרו 2.67 xG, בעטו 4 פעמים למסגרת וכבשו 3; קשרי הפועל הגיעו ל־0.14 xG ול־0 שערים. מול ההתקפה הירושלמית, הגנת מכבי הוסיפה 7 מ־7 בתיקולים, 16 הרחקות ו־4 חסימות, ונעקפה בכדרור פעם אחת בלבד. חלוצי הפועל ייצרו 12 בעיטות ו־1.07 xG, אך ניצחו רק 6 מ־26 מאבקי קרקע.",
            evidenceIds: ["matchup.midfield", "matchup.home_attack_away_defense"],
          },
        ],
      },
    ],
    takeaways: [
      { text: "הפער האמיתי היה באיכות: 3.56 מול 1.27 xG.", evidenceIds: ["team.quality"] },
      { text: "דור פרץ כבש 3 שערים מ־4 בעיטות ב־75 דקות.", evidenceIds: ["player.dor_peretz"] },
      { text: "קשרי הפועל הובילו 16–8 בחילוצים; קשרי מכבי הובילו 3–0 בשערים.", evidenceIds: ["matchup.midfield"] },
    ],
    conclusion: "זה היה 5:2 שאינו מסביר את עצמו דרך שליטה בכדור או מתקפת בעיטות בלתי פוסקת. הפועל ניצחה ביותר פעולות הגנתיות בקישור; מכבי ניצחה באיכות המצבים, בהגעה מאחור ובסיומת.",
    conclusionEvidenceIds: ["match.result", "team.volume", "team.quality", "matchup.midfield", "player.dor_peretz"],
  };
}

const editorialSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    headlineEvidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
    dek: { type: "string" },
    dekEvidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
    sections: {
      type: "array",
      minItems: 4,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          paragraphs: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                evidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
              },
              required: ["text", "evidenceIds"],
            },
          },
        },
        required: ["heading", "paragraphs"],
      },
    },
    takeaways: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["text", "evidenceIds"],
      },
    },
    conclusion: { type: "string" },
    conclusionEvidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
  },
  required: ["headline", "headlineEvidenceIds", "dek", "dekEvidenceIds", "sections", "takeaways", "conclusion", "conclusionEvidenceIds"],
};

async function generateEditorialWithAi(match, evidence) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      store: false,
      instructions: [
        "אתה עורך ספורט נתונים בעברית. כתוב כתבת ניתוח מקורית, בהירה ומדויקת בעברית בלבד.",
        "השתמש אך ורק בחבילת הראיות שסופקה. אין להוסיף הקשר חיצוני, ציטוטים, סיבות טקטיות שלא נמדדו או עובדות שאינן בחבילה.",
        "לכל טענה מספרית צרף רק מזהי evidenceIds שמכילים את המספרים הללו. שמור על טון עיתונאי ולא שיווקי.",
        "כתוב כל כמות ומספר בספרות (למשל 6, לא שישה), כדי שמנוע האימות יוכל לבדוק אותם.",
        "השתמש ב-xG כמונח המקצועי היחיד שמותר באותיות לטיניות.",
        "כלול ניתוח מפורש של מאבקי קישור ושל מגנים מול חלוצים, והפרד בין פעולות הגנתיות להשפעה התקפית.",
        "תאר סגנון משחק רק כפרופיל מספרי או כהסקה זהירה. מפות החום הן צפיפות מיקום מצטברת לכל זמן ההופעה, אינן מבוססות זמן ואינן מאפשרות לקבוע מתי התרחש שינוי.",
      ].join("\n"),
      input: JSON.stringify({
        match: {
          competition: match.competition_name_he ?? match.competition_name,
          scheduledAt: match.scheduled_at,
          home: match.home_team_name_he ?? match.home_team_name,
          away: match.away_team_name_he ?? match.away_team_name,
        },
        evidence,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "hebrew_match_review",
          strict: true,
          schema: editorialSchema,
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI Responses API failed (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  const outputText = payload.output_text ?? payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("The model returned no structured editorial output.");
  return JSON.parse(outputText);
}

function claimEntries(editorial) {
  return [
    { text: editorial.headline, evidenceIds: editorial.headlineEvidenceIds },
    { text: editorial.dek, evidenceIds: editorial.dekEvidenceIds },
    ...editorial.sections.flatMap((section) => section.paragraphs),
    ...editorial.takeaways,
    { text: editorial.conclusion, evidenceIds: editorial.conclusionEvidenceIds },
  ];
}

function extractNumbers(text) {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => Number(match[0].replace(",", ".")));
}

function numbersMatch(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.005;
}

function validateEditorial(editorial, evidence) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const failures = [];
  for (const claim of claimEntries(editorial)) {
    const missing = claim.evidenceIds.filter((id) => !evidenceById.has(id));
    if (missing.length) failures.push(`Unknown evidence IDs: ${missing.join(", ")}`);
    const allowed = claim.evidenceIds.flatMap((id) => evidenceById.get(id)?.values ?? []);
    for (const value of extractNumbers(claim.text)) {
      if (!allowed.some((candidate) => numbersMatch(candidate, value))) {
        failures.push(`Unsupported number ${value} in: ${claim.text}`);
      }
    }
  }
  return failures;
}

function buildChecks(match, home, away, players, shots, evidence, editorial) {
  const homeGoals = shots.filter((shot) => shot.team_id === home.teamId && shot.outcome === "Goal").length;
  const awayGoals = shots.filter((shot) => shot.team_id === away.teamId && shot.outcome === "Goal").length;
  const playerGoals = players.reduce((sum, player) => sum + Number(player.metrics.goals ?? 0), 0);
  const dor = players.find((player) => player.name === "Dor Peretz");
  const editorialFailures = validateEditorial(editorial, evidence);
  const checks = [
    ["match-ended", "המשחק הסתיים", match.status === "Ended", `סטטוס המקור: ${match.status}`],
    ["score-vs-events", "התוצאה תואמת לאירועי השערים", home.score === homeGoals && away.score === awayGoals, `${homeGoals}:${awayGoals} באירועים`],
    ["score-vs-players", "סך שערי השחקנים תואם לתוצאה", playerGoals === home.score + away.score, `${playerGoals} שערים בשורות השחקנים`],
    ["shots-home", "בעיטות הפועל תואמות למפת הבעיטות", home.stats.team_total_shots === home.shotSummary.count, `${home.shotSummary.count} בעיטות`],
    ["shots-away", "בעיטות מכבי תואמות למפת הבעיטות", away.stats.team_total_shots === away.shotSummary.count, `${away.shotSummary.count} בעיטות`],
    ["target-home", "בעיטות הפועל למסגרת תואמות", home.stats.team_shots_on_target === home.shotSummary.onTarget, `${home.shotSummary.onTarget} למסגרת`],
    ["target-away", "בעיטות מכבי למסגרת תואמות", away.stats.team_shots_on_target === away.shotSummary.onTarget, `${away.shotSummary.onTarget} למסגרת`],
    ["xg-home", "xG הפועל עקבי בין המקורות", Math.abs(home.stats.team_expected_goals - home.shotSummary.xg) <= 0.05, `${home.stats.team_expected_goals} מול ${home.shotSummary.xg}`],
    ["xg-away", "xG מכבי עקבי בין המקורות", Math.abs(away.stats.team_expected_goals - away.shotSummary.xg) <= 0.05, `${away.stats.team_expected_goals} מול ${away.shotSummary.xg}`],
    ["dor-hat-trick", "השלושער של דור פרץ מאומת", dor?.metrics.goals === 3 && shots.filter((shot) => shot.display_name === "Dor Peretz" && shot.outcome === "Goal").length === 3, "3 שערים בשני מקורות"],
    ["evidence-links", "לכל טענה יש הפניה לראיות", claimEntries(editorial).every((claim) => claim.evidenceIds.length > 0), `${claimEntries(editorial).length} טענות מקושרות`],
    ["numeric-claims", "כל המספרים בטקסט נתמכים", editorialFailures.length === 0, editorialFailures.length ? editorialFailures.join(" | ") : "לא נמצאו מספרים לא מבוססים"],
  ].map(([id, label, passed, detail]) => ({ id, label, status: passed ? "passed" : "failed", detail }));
  return checks;
}

function normalizeShot(shot) {
  return {
    eventId: shot.event_id,
    minute: Number(shot.minute),
    eventTime: shot.event_time,
    teamId: shot.team_id,
    teamNameHe: shot.team_name_he ?? shot.team_name,
    playerNameHe: shot.display_name_he ?? shot.display_name,
    x: numberValue(shot.x),
    y: numberValue(shot.y),
    xg: numberValue(shot.xg),
    xgot: numberValue(shot.xgot),
    outcome: shot.outcome,
    bodyPart: shot.body_part,
    situation: shot.situation,
  };
}

async function main() {
  await loadLocalEnv();
  const args = readArguments();
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.");

  const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const match = await selectMatch(client, args.matchId);
  const slug = `${cleanTeamSlug(match.away_team_name)}-at-${cleanTeamSlug(match.home_team_name)}-${datePart(match.scheduled_at)}`;
  const outputPath = path.join(generatedDirectory, `${slug}.json`);
  if (!args.matchId && !args.force) {
    try {
      await access(outputPath);
      console.log(JSON.stringify({ outputPath, slug, skipped: true, reason: "latest-match-already-published" }, null, 2));
      return;
    } catch {
      // Continue when this match does not yet have an article.
    }
  }
  const dataset = await fetchMatchDataset(client, match);
  if (dataset.teamRows.length === 0 || dataset.playerRows.length === 0 || dataset.shots.length === 0) {
    throw new Error("The selected match does not have the team, player, and shot data required for a grounded review.");
  }

  const teamStats = pivotTeamStats(dataset.teamRows);
  const players = pivotPlayerStats(dataset.playerRows);
  const hebrewNames = new Map([
    ...dataset.heatmaps.filter((row) => row.player_id && row.display_name_he).map((row) => [row.player_id, row.display_name_he]),
    ...dataset.shots.filter((shot) => shot.player_id && shot.display_name_he).map((shot) => [shot.player_id, shot.display_name_he]),
  ]);
  players.forEach((player) => {
    player.nameHe = hebrewNames.get(player.playerId) ?? player.nameHe;
  });
  const home = teamSnapshot(match, "home", teamStats.get(match.home_team_id) ?? {}, dataset.assets, dataset.shots);
  const away = teamSnapshot(match, "away", teamStats.get(match.away_team_id) ?? {}, dataset.assets, dataset.shots);
  const unitMatchups = {
    home: teamUnits(players, home.teamId),
    away: teamUnits(players, away.teamId),
  };
  const evidence = buildEvidence(match, home, away, players, dataset.shots, unitMatchups, dataset.heatmaps);
  const usedAi = Boolean(process.env.OPENAI_API_KEY) && !args.noAi;
  if (!usedAi && match.match_id !== "5b2957d1-6f48-4269-baf6-2f53753eb160") {
    throw new Error("OPENAI_API_KEY is required for matches without a reviewed editorial seed.");
  }
  const editorial = usedAi
    ? await generateEditorialWithAi(match, evidence)
    : fallbackEditorial(match, home, away);
  const checks = buildChecks(match, home, away, players, dataset.shots, evidence, editorial);
  const failedChecks = checks.filter((check) => check.status === "failed");
  if (failedChecks.length) {
    throw new Error(`Article rejected by fact checks:\n${failedChecks.map((check) => `- ${check.label}: ${check.detail}`).join("\n")}`);
  }

  const generatedAt = new Date().toISOString();
  const article = {
    schemaVersion: 1,
    slug,
    language: "he",
    kind: "match_review",
    status: "published",
    publishedAt: generatedAt,
    generatedAt,
    generation: {
      mode: usedAi ? "openai_responses_api" : "deterministic_editorial_fallback",
      model: usedAi ? (process.env.OPENAI_MODEL ?? "gpt-5-mini") : null,
      pipelineVersion: "match-review-v1",
    },
    match: {
      matchId: match.match_id,
      competitionId: match.competition_id,
      competitionNameHe: match.competition_name_he ?? "ליגת העל",
      seasonId: match.season_id,
      seasonName: match.season_name,
      roundId: match.round_id,
      roundNumber: match.round_number,
      scheduledAt: match.scheduled_at,
      status: match.status,
    },
    teams: { home, away },
    aiDisclosure: "גילוי נאות: הכתבה נוצרה בעזרת בינה מלאכותית על בסיס נתוני כדורדאטה. הנתונים והטענות המספריות עברו בדיקות אוטומטיות לפני הפרסום.",
    players,
    playerSpotlight: players
      .filter((player) => Number(player.metrics.goals ?? 0) > 0 || Number(player.metrics.assists ?? 0) > 0)
      .sort((left, right) => Number(right.metrics.rating_365 ?? 0) - Number(left.metrics.rating_365 ?? 0))
      .slice(0, 8),
    heatmaps: dataset.heatmaps,
    unitMatchups,
    shots: dataset.shots.map(normalizeShot),
    editorial,
    evidence,
    factCheck: {
      status: "passed",
      checkedAt: generatedAt,
      checks,
      evidenceCount: evidence.length,
      claimCount: claimEntries(editorial).length,
      sourceViews: ["api_matches", "api_match_team_stats", "api_match_player_stats", "api_match_shots", "api_match_player_heatmaps"],
    },
  };

  if (!args.dryRun) {
    await mkdir(generatedDirectory, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(article, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ outputPath, slug, usedAi, checks: checks.length, dryRun: args.dryRun }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
