// A goal-line clearance is both a blocked shot and a shot on target. The shot
// chart's outcome alone cannot distinguish it from an ordinary blocked shot.
// Add entries only after primary-source verification of the specific event;
// never infer them from coordinates or from the aggregate count being short.
const verifiedGoalLineBlocks = [
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
  const relevant = shots.filter((shot) => shot.team_id === teamId);
  const goalsAndSaves = relevant.filter((shot) => ["Goal", "Saved"].includes(shot.outcome)).length;
  const goalLineBlocks = relevant.map(verifiedGoalLineBlock).filter(Boolean);
  return { count: goalsAndSaves + goalLineBlocks.length, goalsAndSaves, goalLineBlocks };
}

export function shotsOnTargetDetail(summary) {
  if (!summary.goalLineBlocks.length) return `${summary.count} למסגרת`;
  return `${summary.count} למסגרת; שערים ועצירות שוער: ${summary.goalsAndSaves}; חסימות מקו השער שאומתו במקור ראשוני: ${summary.goalLineBlocks.length}`;
}
