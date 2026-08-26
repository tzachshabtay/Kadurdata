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
  unitMatchups: { home: ArticleTeamUnits; away: ArticleTeamUnits };
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
