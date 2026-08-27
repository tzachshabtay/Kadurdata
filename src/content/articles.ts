import type { ContentArticle } from "./types";

const generatedModules = import.meta.glob("./generated/*.json", {
  eager: true,
  import: "default",
}) as Record<string, ContentArticle>;

export const articles = Object.values(generatedModules)
  .filter((article) => (
    article.language === "he"
    && article.status === "published"
    && article.generation.mode === "openai_writer_and_editor"
    && article.editorialReview.mode === "openai_second_pass_editor"
    && article.editorialReview.status === "passed"
    && article.factCheck.status === "passed"
  ))
  .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));

export const featuredArticle = articles[0];
