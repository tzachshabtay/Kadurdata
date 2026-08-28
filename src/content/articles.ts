import type { ContentArticle } from "./types";

const generatedModules = import.meta.glob("./generated/*.json", {
  eager: true,
  import: "default",
}) as Record<string, ContentArticle>;

export const articles = Object.values(generatedModules)
  .filter((article) => (
    article.language === "he"
    && article.status === "published"
    && article.generation.mode === "openai_analyst_writer_editor_and_qa"
    && article.generation.pipelineVersion === "match-review-v17"
    && article.editorialReview.mode === "openai_second_pass_editor"
    && article.editorialReview.status === "passed"
    && article.qualityReview?.mode === "openai_independent_quality_gate"
    && article.qualityReview.status === "passed"
    && article.qualityReview.checks.storyValue
    && article.qualityReview.checks.gameStateContext
    && article.qualityReview.checks.graphicRelevance
    && article.qualityReview.checks.explanatoryDepth
    && article.qualityReview.checks.historicalAuditComplete
    && article.qualityReview.issues.length === 0
    && article.factCheck.status === "passed"
  ))
  .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));

export const featuredArticle = articles[0];
