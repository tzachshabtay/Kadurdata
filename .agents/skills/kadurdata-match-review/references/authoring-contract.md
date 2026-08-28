# Authoring contract

The workbench writes two ignored files under `.content-workbench/<slug>/`:

- `source.json`: immutable match data, evidence, candidates, and deterministic context.
- `authored.template.json`: the exact authoring shape. Copy it to `authored.json`; never edit `source.json`.

## Required authored fields

- `model`: the Codex model selected for the task.
- `analysisPlan`: one thesis, 3–5 ranked insights, a two-or-more-source explanatory model, the mandatory historical audit, a narrative arc, 2–4 distinct relevant graphics, all eight coverage decisions, and all quality flags.
- `editorial`: headline, dek, 3–6 sections, exactly three takeaways, and a conclusion. Each claim carries one or more valid `evidenceIds`.
- `editorialReview`: `status: "passed"`, all twelve checks true, and concise notes describing actual changes.
- `qualityReview`: `status: "passed"`, all twelve checks true, `issues: []`, and a positive attempt number.

Use the TypeScript definitions in `src/content/types.ts` when a field is unclear. Use candidate IDs verbatim. A section may reference only insights selected in `analysisPlan.rankedInsights`.

## Focused inspection

Prefer small `jq` queries, for example:

```bash
rtk jq '{match,teams,gameStateContext,mechanismContext,historicalAuditContext}' <source.json>
rtk jq '.insightCandidates | sort_by(-.score)' <source.json>
rtk jq '.evidence[] | {id,label,values,context}' <source.json>
rtk jq '{spatialProfile,unitMatchups,flowWindows,timelineEvents}' <source.json>
```

Inspect historical team metrics and every player with non-empty `notableChanges`. The audit decision must match the history coverage decision and the evidence actually used in the prose.

## Finalization

The finalizer derives tags from player names used in the article, stamps the Codex-skill generation modes, recomputes every fact check from the raw source, and writes `src/content/generated/<slug>.json` only when all checks pass.

Never edit stored check results to bypass a failure. Fix the analysis plan or prose and run finalization again.
