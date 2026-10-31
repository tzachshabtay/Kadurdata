import { excludeVerifiedDuplicateShots } from "./content_shot_duplicates.mjs";

// An explicitly tagged own goal changes the score, but is not a shooting
// attempt or a goal scored by the player whose deflection caused it.
export function isOwnGoal(shot) {
  return shot.outcome === "Goal" && shot.situation === "Own Goal";
}

export function shootingAttempts(shots) {
  return excludeVerifiedDuplicateShots(shots).filter((shot) => !isOwnGoal(shot));
}

export function goalsForTeam(shots, teamId, opponentTeamId) {
  return shots.filter((shot) => shot.outcome === "Goal"
    && (isOwnGoal(shot) ? shot.team_id === opponentTeamId : shot.team_id === teamId)).length;
}

export function storedGoalErrors(article) {
  const failures = [];
  const { home, away } = article.teams;
  const goals = article.timelineEvents.filter((event) => event.type === "Goal");
  const ownGoals = goals.filter((event) => event.ownGoal === true);
  if (goals.some((event) => ![home.teamId, away.teamId].includes(event.teamId))) failures.push("goal timeline contains an unknown team");
  if (article.shots.some(isOwnGoal)) failures.push("own goal must not be counted as a shooting attempt");
  if (article.timelineEvents.some((event) => event.ownGoal === true && event.type !== "Goal")) failures.push("own-goal marker is attached to a non-goal event");
  for (const team of [home, away]) {
    const scored = article.shots.filter((shot) => shot.teamId === team.teamId && shot.outcome === "Goal").length;
    const receivedOwnGoals = ownGoals.filter((event) => event.teamId === team.teamId).length;
    if (scored + receivedOwnGoals !== team.score) failures.push(`${team === home ? "home" : "away"} goals do not match shot events and own goals`);
    if (goals.filter((event) => event.teamId === team.teamId).length !== team.score) failures.push(`${team === home ? "home" : "away"} goals do not match timeline events`);
  }
  if (ownGoals.length) {
    const recorded = article.evidence.find((item) => item.id === "timeline.goals")?.context?.ownGoals ?? [];
    if (recorded.length !== ownGoals.length || ownGoals.some((event) => !recorded.some((goal) => goal.teamId === event.teamId && goal.minute === event.minute && goal.playerNameHe === event.playerNameHe))) {
      failures.push("own-goal timeline differs from the raw-event evidence");
    }
  }
  return failures;
}
