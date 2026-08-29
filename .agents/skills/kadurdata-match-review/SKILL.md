---
name: kadurdata-match-review
description: Prepare, write, fact-check, and publish Hebrew Kadurdata match-review articles from repository data without calling a paid model API. Use for one-off or scheduled Kadurdata blog generation; do not use for unrelated site copy.
---

# Kadurdata match review

Create one evidence-grounded Hebrew article through the repository workbench. The Codex task supplies the analysis and writing; repository scripts collect data and enforce publication checks. Natural Hebrew is a release requirement, not a self-reported preference.

Never call the OpenAI API, add an API key, or restore the retired GitHub Actions generator. Native Codex model usage is the only generative layer.

## Run the workflow

1. Inspect the working tree and preserve unrelated changes. Read [references/editorial-standards.md](references/editorial-standards.md) before choosing the story and [references/hebrew-voice-guide.md](references/hebrew-voice-guide.md) before writing or reviewing visible copy.
2. Run `npm run content:prepare -- [--match-id <uuid>]`. If the result says the current skill article is already published, stop without changing files. If it reports an existing workbench, resume it.
3. Inspect the reported `source.json`. Start with `match`, `teams`, `gameStateContext`, `mechanismContext`, `historicalAuditContext`, `insightCandidates`, `spatialProfile`, `unitMatchups`, `flowWindows`, `timelineEvents`, and `evidence`. Query focused portions rather than loading the entire package at once.
4. Choose one thesis and 3–5 connected insights. Review every historical signal even when the correct publication decision is to omit history. Apply a reader-value gate before selecting an insight: it must describe a concrete football contrast, explain why it mattered, and add something the reader cannot get from the match-data page alone. Treat heatmaps as full-appearance spatial summaries, never as time-based evidence. A heatmap insight is eligible only when it is triangulated with another evidence family and can be written as football analysis rather than a paragraph about data limitations.
5. Use four sequential roles with distinct real agent IDs: analyst, writer, Hebrew editor, and blind reviewer. The analyst may remain the coordinating agent. When collaboration agents are available, run the writer, editor, and reviewer in fresh contexts with no inherited conversation. Do not publish without genuine role separation; never fill another role's review on its behalf.
6. Copy `authored.template.json` to `authored.json` and follow [references/authoring-contract.md](references/authoring-contract.md). The analyst fills `analysisPlan`; the fresh-context writer receives that plan and fills `draftEditorial` only. Every numerical claim must cite evidence whose `values` contains that number.
7. The Hebrew editor receives the draft, focused evidence, and the voice guide—not the writer's self-assessment. The editor writes the final `editorial`, records concrete changes, and reviews every visible sentence. Abstract analysis language, literal translations, number dumps, vague football descriptions, and paragraphs explaining what the data cannot show must be rewritten or removed rather than approved. Keep necessary methodological limits in a graphic subtitle or internal review note; the article body must spend its space on the match.
8. The blind reviewer first reads only the final visible copy and its numberless form, then checks the evidence. It reviews every sentence independently and rejects any sentence that an Israeli sports editor would still change. It also rejects an insight whose main contribution is methodology, caveats, or a restatement of the graphic. It must not repair the article or inherit the editor's conclusions; send failures back to a new editor pass.
9. Run `npm run content:check:language-review`, then `npm run content:finalize -- --source <source.json> --authored <authored.json>`. The regression check ensures decimal statistics remain intact in sentence-level review. The finalizer verifies distinct roles, exact-text hashes, sentence coverage, concrete edits, the numberless read, and the factual checks, then writes ignored `candidate.json` and `candidate-preview.html` files beside the workbench inputs. It never writes to the public blog. Fix the authored package rather than weakening a gate.
10. Give the user a readable preview before asking for approval. Open `candidate-preview.html` locally, or run `npm run content:preview -- --candidate <candidate.json>` and open the reported localhost URL. The preview must show the exact reviewed copy and remain outside the public blog. Stop after presenting it. Only after the user explicitly approves that exact candidate in a later message may you run `npm run content:publish -- --candidate <candidate.json> --approved-by-user --approval-note <note>`, followed by `npm run content:validate` and `npm run build`. Never infer approval from a request to prepare, revise, preview, finalize, schedule, or automate an article. Never commit `.content-workbench`.

Use `rtk` at the start of every shell command in this repository. Use `apply_patch` for hand-authored file changes.

## Publication boundaries

- Publish only Hebrew match reviews with the AI disclosure already supplied by the source package.
- Do not publish when match, shot, lineup, heatmap, or historical inputs needed by the selected thesis are missing.
- Do not force a graphic category. Select 2–4 distinct code-native graphics only when each materially supports a chosen insight.
- Do not invent a tactical sequence from aggregate heatmaps. Combine spatial evidence with a separate evidence family such as shot locations, role-level production, progression, crosses, or timed events. Put the heatmap's time limitation in the graphic subtitle, not in a standalone body paragraph. If the spatial evidence does not produce a useful football insight without a long caveat, omit it and its graphic.
- Do not expose the analytical scaffolding in the prose. Write what a team or player did on the pitch instead of referring to “the reading”, “the mechanism”, “the signal”, or a generic metric family.
- Do not expose a candidate on the public blog before explicit user approval. Finalization and publication are separate operations.
- Do not make users review raw JSON. Generate and open the local HTML preview for every candidate; a preview is not publication approval.
- If no eligible unpublished match exists, make no commit and report that outcome.
