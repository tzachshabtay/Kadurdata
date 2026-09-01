export type ArticleEvidence = {
  id: string;
  label: string;
  sourceView: string;
  sourceRows: number;
  values: number[];
  context?: Record<string, unknown>;
};

export type ArticleTag = {
  id: string;
  label: string;
  kind: "team" | "player" | "topic";
};

export type ArticleClaim = {
  text: string;
  evidenceIds: string[];
};

export type ArticleEditorial = {
  headline: string;
  headlineEvidenceIds: string[];
  dek: string;
  dekEvidenceIds: string[];
  sections: Array<{ heading: string; insightIds: string[]; paragraphs: ArticleClaim[] }>;
  takeaways: ArticleClaim[];
  conclusion: string;
  conclusionEvidenceIds: string[];
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

export type ArticleHistoricalMetric = {
  current: number | null;
  average: number;
  sampleSize: number;
  delta: number | null;
  changePercent: number | null;
};

export type ArticleHistoricalMatch = {
  matchId: string;
  scheduledAt: string;
  competitionNameHe: string;
  opponentTeamId: string;
  opponentNameHe: string;
  goalsFor: number;
  goalsAgainst: number;
};

export type ArticleHistoricalTeam = {
  teamId: string;
  nameHe: string;
  matchCount: number;
  averageGoalsFor: number;
  averageGoalsAgainst: number;
  matches: ArticleHistoricalMatch[];
  metrics: Record<string, ArticleHistoricalMetric>;
};

export type ArticleHistoricalPlayerMetric = {
  current: number | null;
  currentPer90: number | null;
  previousTotal: number;
  previousPer90: number | null;
  previousStdDevPer90: number | null;
  deltaPer90: number | null;
  changePercent: number | null;
  sampleSize: number;
  minutesWithMetric: number;
};

export type ArticleHistoricalPlayerChange = {
  metricCode: string;
  labelHe: string;
  current: number;
  currentPer90: number;
  previousPer90: number;
  previousStdDevPer90: number;
  deltaPer90: number;
  changePercent: number;
  zScore: number | null;
  sampleSize: number;
};

export type ArticleHistoricalPlayer = {
  playerId: string;
  nameHe: string;
  teamId: string;
  appearanceCount: number;
  totalMinutes: number;
  metrics: Record<string, ArticleHistoricalPlayerMetric>;
  notableChanges: ArticleHistoricalPlayerChange[];
};

export type ArticleEditorialReview = {
  mode: string;
  model: string | null;
  status: "passed" | "failed";
  writerAgentId: string;
  editorAgentId: string;
  draftHash: string;
  finalHash: string;
  changes: Array<{
    location: string;
    original: string;
    revised: string;
    category: "translationese" | "abstract_language" | "football_register" | "clarity" | "rhythm" | "numeric_overload" | "cohesion";
    reasonHe: string;
  }>;
  sentenceReviews: Array<{
    location: string;
    text: string;
    verdict: "passed" | "failed";
    noteHe: string;
  }>;
  checks: {
    naturalHebrew: boolean;
    footballHebrew: boolean;
    numericClarity: boolean;
    cohesiveNarrative: boolean;
    storyValue: boolean;
    numberDiscipline: boolean;
    highVolumeComparisonsOnly: boolean;
    evidenceFaithfulness: boolean;
    gameStateContext: boolean;
    graphicRelevance: boolean;
    explanatoryDepth: boolean;
    playerRoleAttribution: boolean;
    historicalAuditComplete: boolean;
  };
  notes: string[];
};

export type ArticleQualityReview = {
  mode: string;
  model: string | null;
  status: "passed" | "failed";
  reviewerAgentId: string;
  reviewedHash: string;
  numberlessHash: string;
  sentenceReviews: ArticleEditorialReview["sentenceReviews"];
  numberlessReview: {
    status: "passed" | "failed";
    articleStillCoherent: boolean;
    summaryHe: string;
    issues: string[];
  };
  checks: ArticleEditorialReview["checks"];
  issues: string[];
  attempt: number;
};

export type ArticleHistoricalContext = {
  windowSize: number;
  scopeHe: string;
  teams: { home: ArticleHistoricalTeam; away: ArticleHistoricalTeam };
  players: ArticleHistoricalPlayer[];
};

export type ArticleInsight = {
  id: string;
  titleHe: string;
  findingHe: string;
  whyItMattersHe: string;
  evidenceIds: string[];
  importance: "primary" | "supporting" | "context";
  narrativeRole: "setup" | "turning_point" | "explanation" | "context" | "caveat";
};

export type MatchArticleGraphicSpec = {
  type: "match_flow" | "shot_map" | "team_history" | "tactical_heatmap" | "player_focus";
  titleHe: string;
  subtitleHe: string;
  placementInsightId: string;
  evidenceIds: string[];
  metricCodes: string[];
  focusPlayerId: string;
};

export type LegionnaireArticleGraphicSpec = {
  type: "legionnaire_workload" | "legionnaire_metric" | "legionnaire_trend";
  titleHe: string;
  subtitleHe: string;
  placementInsightId: string;
  evidenceIds: string[];
  metricCode: string;
  playerIds: string[];
};

export type ArticleGraphicSpec = MatchArticleGraphicSpec | LegionnaireArticleGraphicSpec;

export type ArticleAnalysisPlan<TGraphic extends ArticleGraphicSpec = ArticleGraphicSpec> = {
  thesis: { claimHe: string; whyItMattersHe: string; evidenceIds: string[] };
  rankedInsights: ArticleInsight[];
  explanatoryModel: {
    questionHe: string;
    answerHe: string;
    supportLevel: "triangulated" | "descriptive";
    evidenceIds: string[];
    components: Array<{
      findingHe: string;
      whyItExplainsHe: string;
      confidence: "high" | "medium" | "low";
      limitationHe: string;
      evidenceIds: string[];
    }>;
  };
  historicalAudit: {
    decision: "use" | "omit";
    teamSignalsReviewed: boolean;
    playerSignalsReviewed: boolean;
    findingHe: string;
    evidenceIds: string[];
  };
  narrativeArc: Array<{ headingIdeaHe: string; purposeHe: string; insightIds: string[] }>;
  graphics: TGraphic[];
  coverageDecisions: Array<{
    category: "game_state" | "flow" | "quality" | "style" | "matchup" | "spatial" | "history" | "player";
    decision: "use" | "omit";
    reasonHe: string;
    evidenceIds: string[];
  }>;
  quality: {
    singleThesis: boolean;
    explainsRatherThanLists: boolean;
    readerValue: boolean;
    gameStateAdjusted: boolean;
    selectiveEvidence: boolean;
    graphicsServeStory: boolean;
    explanatoryDepth: boolean;
    playerRoleAttribution: boolean;
    historicalAuditComplete: boolean;
  };
};

export type ArticleGeneration = {
  mode: string;
  analystModel: string | null;
  writerModel: string | null;
  model: string | null;
  editorModel: string | null;
  qualityModel: string | null;
  pipelineVersion: string;
};

export type ArticleAuthorship = {
  analystAgentId: string;
  writerAgentId: string;
  editorAgentId: string;
  reviewerAgentId: string;
};

export type ArticleApproval = {
  status: "pending" | "approved";
  approvedAt: string | null;
  note: string | null;
};

export type ArticleFactCheck = {
  status: "passed" | "failed";
  checkedAt: string;
  checks: Array<{ id: string; label: string; status: "passed" | "failed"; detail: string }>;
  evidenceCount: number;
  claimCount: number;
  sourceViews: string[];
};

export type MatchReviewArticle = {
  schemaVersion: number;
  slug: string;
  language: "he";
  kind: "match_review";
  status: "published" | "draft";
  publishedAt: string | null;
  finalizedAt?: string;
  generatedAt: string;
  generation: ArticleGeneration;
  authorship: ArticleAuthorship;
  approval?: ArticleApproval;
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
  tags: ArticleTag[];
  aiDisclosure: string;
  players: ArticlePlayer[];
  playerSpotlight: ArticlePlayer[];
  heatmaps: ArticleHeatmap[];
  spatialProfile: ArticleSpatialProfile | null;
  unitMatchups: { home: ArticleTeamUnits; away: ArticleTeamUnits };
  timelineEvents: ArticleTimelineEvent[];
  flowWindows: ArticleFlowWindow[];
  actualPlayTime: { actual: string | null; total: string | null } | null;
  historicalContext: ArticleHistoricalContext;
  historicalAuditContext: Record<string, unknown>;
  gameStateContext: Record<string, unknown>;
  mechanismContext: Record<string, unknown>;
  insightCandidates: Array<{ id: string; category: string; score: number; evidenceIds: string[]; context: unknown }>;
  analysisPlan: ArticleAnalysisPlan<MatchArticleGraphicSpec>;
  shots: ArticleShot[];
  editorialReview: ArticleEditorialReview;
  qualityReview: ArticleQualityReview;
  editorial: ArticleEditorial;
  evidence: ArticleEvidence[];
  factCheck: ArticleFactCheck;
};

export type LegionnaireWeeklyMatch = {
  matchId: string;
  scheduledAt: string;
  teamName: string;
  opponentName: string;
  minutes: number;
  started: boolean;
  scoreFor: number | null;
  scoreAgainst: number | null;
  metrics: Record<string, number>;
  dataCompleteness: "full" | "basic";
};

export type LegionnaireWeeklyPlayer = {
  playerId: string;
  nameHe: string;
  teamName: string;
  competitionNameHe: string;
  position: string | null;
  appearances: number;
  starts: number;
  minutes: number;
  metrics: Record<string, number>;
  per90: Record<string, number>;
  baseline: {
    matchCount: number;
    minutes: number;
    per90: Record<string, number>;
  };
  matches: LegionnaireWeeklyMatch[];
};

export type LegionnaireWeeklyArticle = {
  schemaVersion: number;
  slug: string;
  language: "he";
  kind: "legionnaire_weekly";
  status: "published" | "draft";
  publishedAt: string | null;
  finalizedAt?: string;
  generatedAt: string;
  generation: ArticleGeneration;
  authorship: ArticleAuthorship;
  approval?: ArticleApproval;
  period: { start: string; end: string; labelHe: string; seasonName: string };
  summary: {
    eligiblePlayers: number;
    playersWithMinutes: number;
    appearances: number;
    starts: number;
    minutes: number;
    fullStatAppearances: number;
    basicOnlyAppearances: number;
    players: LegionnaireWeeklyPlayer[];
  };
  tags: ArticleTag[];
  aiDisclosure: string;
  analysisPlan: ArticleAnalysisPlan<LegionnaireArticleGraphicSpec>;
  editorialReview: ArticleEditorialReview;
  qualityReview: ArticleQualityReview;
  editorial: ArticleEditorial;
  evidence: ArticleEvidence[];
  factCheck: ArticleFactCheck;
};

export type ContentArticle = MatchReviewArticle | LegionnaireWeeklyArticle;

export function isMatchReviewArticle(article: ContentArticle): article is MatchReviewArticle {
  return article.kind === "match_review";
}
