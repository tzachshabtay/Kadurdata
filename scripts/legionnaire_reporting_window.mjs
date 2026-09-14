const weekMs = 7 * 24 * 60 * 60 * 1000;
export const reportingTimezone = "Asia/Jerusalem";
const completedStatuses = new Set(["Ended", "After ET", "After Penalties"]);

export function rollingReportingWindow(asOf = new Date().toISOString()) {
  if (typeof asOf !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(asOf) || !Number.isFinite(Date.parse(asOf))) {
    throw new Error("--as-of must be an ISO timestamp with an explicit timezone.");
  }
  const end = new Date(asOf);
  const start = new Date(end.getTime() - weekMs);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: reportingTimezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const label = new Intl.DateTimeFormat("he-IL", { timeZone: reportingTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return {
    windowType: "rolling_168_hours",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    timeZone: reportingTimezone,
    start: date.format(start),
    end: date.format(end),
    labelHe: `${label.format(start)} - ${label.format(end)} (שעון ישראל)`,
  };
}

export function isWithinReportingWindow(scheduledAt, period) {
  const kickoff = Date.parse(scheduledAt);
  return kickoff >= Date.parse(period.startAt) && kickoff < Date.parse(period.endAt);
}

// Check status before deduplication so an unfinished import cannot replace an
// ended fixture with a richer but still partial set of statistics.
export function filterCompletedHistory(rows, matches) {
  const byId = new Map(matches.map((match) => [match.match_id, match]));
  const excluded = new Map();
  const eligible = [];
  for (const row of rows) {
    const match = byId.get(row.match_id);
    if (!completedStatuses.has(match?.status) || Date.parse(match.scheduled_at) !== Date.parse(row.scheduled_at)) {
      excluded.set(row.match_id, { matchId: row.match_id, status: match?.status ?? null, reason: "not_verified_completed" });
    } else {
      eligible.push({ ...row, match_status: match.status });
    }
  }
  return { rows: eligible, excludedMatches: [...excluded.values()] };
}

export function assertRollingReportingWindow(article) {
  const period = article.period;
  // Previously published calendar-week articles remain readable/validatable.
  if (!period?.windowType) return;
  if (period.windowType !== "rolling_168_hours" || Date.parse(period.endAt) - Date.parse(period.startAt) !== weekMs) {
    throw new Error("Weekly window must span exactly 168 hours.");
  }
  for (const player of article.summary?.players ?? []) {
    for (const match of player.matches ?? []) {
      if (!isWithinReportingWindow(match.scheduledAt, period) || !completedStatuses.has(match.status)) {
        throw new Error(`Weekly window: ${player.nameHe} / ${match.matchId} is not a completed appearance inside the reporting window.`);
      }
    }
  }
}
