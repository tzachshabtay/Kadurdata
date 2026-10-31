import { shootingAttempts } from "./content_goal_events.mjs";

// A goal-line clearance is both a blocked shot and a shot on target. The shot
// chart's outcome alone cannot distinguish it from an ordinary blocked shot.
// Add entries only after primary-source verification of the specific event;
// never infer them from coordinates or from the aggregate count being short.
const verifiedGoalLineBlocks = [
  {
    matchId: "6f9fd23a-48b9-4547-9fae-adfdf0d9797b",
    sourceCode: "365scores",
    sourceEventId: "164739306",
    teamId: "a3de4ba2-63b7-475e-9975-8f2bb118d546",
    playerId: "3c2fc94a-90e4-41dc-9325-2f710214d51b",
    minute: 59,
    findingHe: "גדראני הרחיק מקו השער את בעיטת רועי לוי לאחר שעבר את סילבה, כפי שמתועד בדיווח הרשמי של בית״ר ירושלים.",
    sourceUrl: "https://www.beitarfc.co.il/news/חוזרים-למסלול-01-לביתר-על-הפועל-פתח-תקו/",
    definitionUrl: "https://www.statsperform.com/opta-event-definitions/",
    verifiedAt: "2026-10-31",
  },
  {
    matchId: "fe0a16ab-0cfc-40b3-9634-39733223c77e",
    sourceCode: "365scores",
    sourceEventId: "324739311",
    teamId: "af106a7f-f0a9-4db3-88d7-bd04ebbfb100",
    playerId: "b6a41010-aafc-4cdc-983e-8e64d0dd852c",
    minute: 89,
    findingHe: "קרבאלי הרחיק מקו השער את בעיטת דור פרץ אחרי יציאת סילבה, כפי שמתועד בדיווח המשחק של נדב צנציפר ב-ynet.",
    sourceUrl: "https://www.ynet.co.il/sport/israelisoccer/article/bkzrtkm2fe",
    definitionUrl: "https://www.statsperform.com/opta-event-definitions/",
    verifiedAt: "2026-10-21",
  },
  {
    matchId: "76e6c0e6-9d63-4813-89a7-772b01b142c7",
    sourceCode: "365scores",
    sourceEventId: "194739340",
    teamId: "af106a7f-f0a9-4db3-88d7-bd04ebbfb100",
    playerId: "713ec20b-f06b-4502-85cf-ba2ba0d9c770",
    minute: 65,
    findingHe: "אמאדור הרחיק מקו השער את בעיטת וארלה, כפי שמתועד בדיווח הרשמי של מכבי תל אביב.",
    sourceUrl: "https://www.maccabi-tlv.co.il/2026/09/הצגה-מכבי-הביסה-14-את-בש-בטרנר/",
    definitionUrl: "https://www.statsperform.com/opta-event-definitions/",
    verifiedAt: "2026-09-08",
  },
  {
    matchId: "b627585d-b1d3-4b29-b4a1-b428e623cda7",
    sourceCode: "365scores",
    sourceEventId: "54739320",
    teamId: "af106a7f-f0a9-4db3-88d7-bd04ebbfb100",
    playerId: "b6a41010-aafc-4cdc-983e-8e64d0dd852c",
    minute: 20,
    findingHe: "שחקן סכנין הרחיק מקו השער את בעיטת דור פרץ, כפי שמתועד בדיווח הרשמי של מכבי תל אביב.",
    sourceUrl: "https://www.maccabi-tlv.co.il/2026/10/מכבי-סיימה-ב-00-מול-בני-סכנין/",
    definitionUrl: "https://www.statsperform.com/opta-event-definitions/",
    verifiedAt: "2026-10-17",
  },
];

export function verifiedGoalLineBlock(shot) {
  if (shot.outcome !== "Blocked") return null;
  return verifiedGoalLineBlocks.find((entry) => (
    shot.match_id === entry.matchId
    && shot.source_code === entry.sourceCode
    && String(shot.source_event_id) === entry.sourceEventId
    && shot.team_id === entry.teamId
    && shot.player_id === entry.playerId
    && Number(shot.minute) === entry.minute
  )) ?? null;
}

export function shotsOnTargetSummary(shots, teamId) {
  const relevant = shootingAttempts(shots).filter((shot) => shot.team_id === teamId);
  const goalsAndSaves = relevant.filter((shot) => ["Goal", "Saved"].includes(shot.outcome)).length;
  const goalLineBlocks = relevant.map(verifiedGoalLineBlock).filter(Boolean);
  return { count: goalsAndSaves + goalLineBlocks.length, goalsAndSaves, goalLineBlocks };
}

export function shotsOnTargetDetail(summary) {
  if (!summary.goalLineBlocks.length) return `${summary.count} למסגרת`;
  return `${summary.count} למסגרת; שערים ועצירות שוער: ${summary.goalsAndSaves}; חסימות מקו השער שאומתו במקור ראשוני: ${summary.goalLineBlocks.length}`;
}
