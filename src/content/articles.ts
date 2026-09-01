import type { ContentArticle } from "./types";

const generatedModules = import.meta.glob("./generated/*.json", {
  eager: true,
  import: "default",
}) as Record<string, ContentArticle>;

const hasPassedReview = (article: ContentArticle) => (
  new Set(Object.values(article.authorship ?? {})).size === 4
  && article.editorialReview.mode === "codex_skill_editor"
  && article.editorialReview.status === "passed"
  && article.qualityReview?.mode === "codex_skill_quality_gate"
  && article.qualityReview.status === "passed"
  && article.qualityReview.checks.storyValue
  && article.qualityReview.checks.gameStateContext
  && article.qualityReview.checks.graphicRelevance
  && article.qualityReview.checks.explanatoryDepth
  && article.qualityReview.checks.playerRoleAttribution
  && article.qualityReview.checks.historicalAuditComplete
  && article.qualityReview.issues.length === 0
  && article.factCheck.status === "passed"
);

export const articles = Object.values(generatedModules)
  .filter((article) => (
    article.language === "he"
    && article.status === "published"
    && article.approval?.status === "approved"
    && article.generation.mode === "codex_skill"
    && (
      (article.kind === "match_review" && article.generation.pipelineVersion === "match-review-v23")
      || (article.kind === "legionnaire_weekly" && article.generation.pipelineVersion === "legionnaire-weekly-v1")
    )
    && hasPassedReview(article)
  ))
  .sort((left, right) => Date.parse(right.publishedAt ?? "") - Date.parse(left.publishedAt ?? ""));

export const featuredArticle = articles[0];
