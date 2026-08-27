export type ArticleEvidence = {
  id: string;
  label: string;
  sourceView: string;
  sourceRows: number;
  values: number[];
};

export type ArticleClaim = {
  text: string;
  evidenceIds: string[];
};

export type ArticleTeam = {
  teamId: string;
  name: string;
  nameHe: string;
  score: number;
  color: string;
  secondaryColor: string | null;
  logoUrl: string | null;
  stats: Record<string, number | null>;
  shotSummary: { count: number; goals: number; onTarget: number; xg: number; xgot: number };
};

export type ArticleShot = {
  eventId: string;
  minute: number;
  eventTime: string;
  teamId: string;
  teamNameHe: string;
  playerNameHe: string;
  x: number;
  y: number;
  xg: number;
  xgot: number;
  outcome: string;
  bodyPart: string | null;
  situation: string | null;
};

export type ArticlePlayer = {
  playerId: string;
  name: string;
  nameHe: string;
  teamId: string;
  teamName: string;
  side: "home" | "away" | null;
  lineupStatus: string | null;
  positionName: string | null;
  formationPosition: string | null;
  shirtNumber: number | null;
  roleGroup: "Goalkeeper" | "Defender" | "Midfielder" | "Attacker" | "Other";
  minutes: number | null;
  metrics: Record<string, number | null>;
};

export type ArticleHeatmap = {
  match_id: string;
  appearance_id: string;
  player_id: string;
  display_name: string;
  display_name_he: string | null;
  team_id: string;
  team_name: string;
  team_name_he: string | null;
  heatmap_url: string;
  source_id: string;
  source_code: string;
  source_name: string;
  observed_at: string;
};

export type ArticleUnitMetrics = {
  playerCount: number;
  recoveries: number;
  interceptions: number;
  tacklesWon: number;
  tacklesAttempted: number;
  expectedGoals: number;
  goals: number;
  shots: number;
  shotsOnTarget: number;
  expectedAssists: number;
  keyPasses: number;
  assists: number;
  groundDuelsWon: number;
  groundDuelsAttempted: number;
  clearances: number;
  blocks: number;
  wasDribbledPast: number;
};

export type ArticleTeamUnits = {
  defenders: ArticleUnitMetrics;
  midfielders: ArticleUnitMetrics;
  attackers: ArticleUnitMetrics;
};

export type ArticleFlowWindow = {
  start: number;
  end: number;
  home: { shots: number; xg: number; goals: number };
  away: { shots: number; xg: number; goals: number };
};

export type ArticleTimelineEvent = {
  id: string;
  minute: number;
  eventTime: string;
  type: string;
  teamId: string;
  teamNameHe: string;
  playerNameHe: string | null;
  relatedPlayerNamesHe: string[];
};

export type ArticleSpatialTeamProfile = {
  sampleSize: number;
  defenderCount: number;
  midfielderCount: number;
  attackerCount: number;
  centralLanePlayers: number;
  halfSpacePlayers: number;
  wideLanePlayers: number;
  leftLanePlayers: number;
  rightLanePlayers: number;
  averageDepth: number;
  width: number;
  playersInAttackingHalf: number;
  playersInFinalThird: number;
  defenderDepth: number;
  midfielderDepth: number;
  attackerDepth: number;
  players: Array<{
    playerId: string;
    nameHe: string;
    roleGroup: ArticlePlayer["roleGroup"];
    formationPosition: string | null;
    x: number;
    y: number;
  }>;
};

export type ArticleSpatialProfile = {
  method: string;
  timed: false;
  starterHeatmaps: number;
  home: ArticleSpatialTeamProfile;
  away: ArticleSpatialTeamProfile;
  positions: Array<{
    playerId: string;
    teamId: string;
    lineupStatus: string | null;
    roleGroup: ArticlePlayer["roleGroup"];
    formationPosition: string | null;
    x: number;
    y: number;
  }>;
};

export type ContentArticle = {
  schemaVersion: number;
  slug: string;
  language: "he";
  kind: "match_review";
  status: "published" | "draft";
  publishedAt: string;
  generatedAt: string;
  generation: { mode: string; model: string | null; pipelineVersion: string };
  match: {
    matchId: string;
    competitionId: string;
    competitionNameHe: string;
    seasonId: string;
    seasonName: string;
    roundId: string | null;
    roundNumber: number | null;
    scheduledAt: string;
    status: string;
  };
  teams: { home: ArticleTeam; away: ArticleTeam };
  aiDisclosure: string;
  players: ArticlePlayer[];
  playerSpotlight: ArticlePlayer[];
  heatmaps: ArticleHeatmap[];
  spatialProfile: ArticleSpatialProfile | null;
  unitMatchups: { home: ArticleTeamUnits; away: ArticleTeamUnits };
  timelineEvents: ArticleTimelineEvent[];
  flowWindows: ArticleFlowWindow[];
  actualPlayTime: { actual: string | null; total: string | null } | null;
  shots: ArticleShot[];
  editorial: {
    headline: string;
    headlineEvidenceIds: string[];
    dek: string;
    dekEvidenceIds: string[];
    sections: Array<{ heading: string; paragraphs: ArticleClaim[] }>;
    takeaways: ArticleClaim[];
    conclusion: string;
    conclusionEvidenceIds: string[];
  };
  evidence: ArticleEvidence[];
  factCheck: {
    status: "passed" | "failed";
    checkedAt: string;
    checks: Array<{ id: string; label: string; status: "passed" | "failed"; detail: string }>;
    evidenceCount: number;
    claimCount: number;
    sourceViews: string[];
  };
};
