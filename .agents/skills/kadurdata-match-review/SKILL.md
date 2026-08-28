---
name: kadurdata-match-review
description: Prepare, write, fact-check, and publish Hebrew Kadurdata match-review articles from repository data without calling a paid model API. Use for one-off or scheduled Kadurdata blog generation; do not use for unrelated site copy.
---

# Kadurdata match review

Create one evidence-grounded Hebrew article through the repository workbench. The Codex task supplies the analysis and writing; repository scripts only collect data and enforce publication checks.

Never call the OpenAI API, add an API key, or restore the retired GitHub Actions generator. Native Codex model usage is the only generative layer.

## Run the workflow

1. Inspect the working tree and preserve unrelated changes. Read [references/editorial-standards.md](references/editorial-standards.md) before choosing the story.
2. Run `npm run content:prepare -- [--match-id <uuid>]`. If the result says the current skill article is already published, stop without changing files. If it reports an existing workbench, resume it.
3. Inspect the reported `source.json`. Start with `match`, `teams`, `gameStateContext`, `mechanismContext`, `historicalAuditContext`, `insightCandidates`, `spatialProfile`, `unitMatchups`, `flowWindows`, `timelineEvents`, and `evidence`. Query focused portions rather than loading the entire package at once.
4. Choose one thesis and 3–5 connected insights. Review every historical signal even when the correct publication decision is to omit history. Treat heatmaps as full-appearance spatial summaries, never as time-based evidence.
5. Copy `authored.template.json` to `authored.json` and replace all scaffold content. Follow [references/authoring-contract.md](references/authoring-contract.md). Every numerical claim must cite evidence whose `values` contains that number.
6. Perform a separate editorial pass: reverse-outline the article, then rewrite unnatural Hebrew, jargon translated literally from English, number dumps, repetition, and unsupported causal claims. Record honest editorial checks; a failed check must remain failed until the text is fixed.
7. Perform a fresh quality pass against the raw evidence and the standards reference. Do not merely reapprove the editorial pass. Resolve every issue, then record the quality checks with an empty `issues` array.
8. Run `npm run content:finalize -- --source <source.json> --authored <authored.json>`, followed by `npm run content:validate` and `npm run build`. A failed finalizer or validator blocks publication; fix the authored package rather than weakening a check.
9. Commit and push the generated article only when the user or scheduled-task prompt explicitly authorizes publication. Never commit `.content-workbench`.

Use `rtk` at the start of every shell command in this repository. Use `apply_patch` for hand-authored file changes.

## Publication boundaries

- Publish only Hebrew match reviews with the AI disclosure already supplied by the source package.
- Do not publish when match, shot, lineup, heatmap, or historical inputs needed by the selected thesis are missing.
- Do not force a graphic category. Select 2–4 distinct code-native graphics only when each materially supports a chosen insight.
- Do not invent a tactical sequence from aggregate heatmaps. Combine spatial evidence with timed shots, goals, cards, and substitutions, and state observational limits.
- If no eligible unpublished match exists, make no commit and report that outcome.
