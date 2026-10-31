// Exact-event reconciliations preserve provider observations. They never infer
// duplicates from matching coordinates alone: rebounds can share a location.
const ansahIdentity = {
  match_id: "6f9fd23a-48b9-4547-9fae-adfdf0d9797b",
  source_code: "365scores",
  team_id: "9cc12c58-fc31-47e8-a7d6-0217b90a4cf3",
  player_id: "a9d814e8-0166-40a7-97b7-8a36ffa7ff6e",
  minute: 90,
  event_time: "90 + 6'",
  x: 72.7,
  y: 53,
  outcome: "Missed",
  body_part: "Right Foot",
  goal_mouth_x: null,
  goal_mouth_y: 37.8,
};

const verifiedPairs = [{
  kept: { ...ansahIdentity, source_event_id: "264739306", situation: "Fast Break", xg: 0.04, xgot: 0 },
  duplicate: { ...ansahIdentity, source_event_id: "274739306", situation: "Regular Play", xg: 0.03, xgot: null },
  verifiedAt: "2026-10-31",
  sourceUrl: "https://www.beitarfc.co.il/news/חוזרים-למסלול-01-לביתר-על-הפועל-פתח-תקו/",
  providerUrl: "https://webws.365scores.com/web/game/?appTypeId=5&langId=1&timezoneName=Asia%2FJerusalem&userCountryId=6&gameId=4739306&topBookmaker=14",
  findingHe: "דיווח המועדון מתאר בעיטת אנסה אחת במתפרצת בתוספת הזמן. מדדי השחקן במקור מונים בעיטה אחת, אחת מחוץ למסגרת ו-0.04 שערים צפויים. שתי רשומות המפה חולקות זהות, זמן, מיקום ונקודת סיום; רשומת המתפרצת תואמת גם לתיאור וגם לערך השחקן, והשנייה היא רישום חוזר שלה.",
}];

function matches(shot, identity) {
  return Object.entries(identity).every(([key, value]) => shot[key] === value);
}

export function verifiedShotDuplicates(shots) {
  return verifiedPairs.flatMap((entry) => {
    const kept = shots.filter((shot) => matches(shot, entry.kept));
    const duplicate = shots.filter((shot) => matches(shot, entry.duplicate));
    // A corrected, absent or ambiguous counterpart must be investigated again.
    if (kept.length !== 1 || duplicate.length !== 1) return [];
    return [{ ...entry, kept: kept[0], duplicate: duplicate[0] }];
  });
}

export function excludeVerifiedDuplicateShots(shots) {
  const duplicates = new Set(verifiedShotDuplicates(shots).map((entry) => entry.duplicate));
  return shots.filter((shot) => !duplicates.has(shot));
}

export function storedShotDuplicateErrors(article) {
  const record = article.evidence.find((item) => item.id === "shots.reconciliation")?.context;
  if (!record) return [];
  const errors = [];
  const events = record.resolutions?.flatMap((entry) => [entry.kept, entry.duplicate]) ?? [];
  const expected = verifiedShotDuplicates(events);
  if (!expected.length || JSON.stringify(expected) !== JSON.stringify(record.resolutions)) errors.push("shot reconciliation differs from verified event identities");
  for (const entry of expected) {
    if (article.shots.some((shot) => shot.eventId === entry.duplicate.event_id)) errors.push("duplicate provider observation is counted as an attempt");
    if (article.shots.filter((shot) => shot.eventId === entry.kept.event_id).length !== 1) errors.push("reconciled shooting attempt is missing or repeated");
  }
  return errors;
}
