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
  minutes: number | null;
  metrics: Record<string, number | null>;
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
  playerSpotlight: ArticlePlayer[];
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
