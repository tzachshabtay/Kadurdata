# Authoring contract

The workbench writes two ignored files under `.content-workbench/<slug>/`:

- `source.json`: immutable match data, evidence, candidates, and deterministic context.
- `authored.template.json`: the base authoring shape. Copy it to `authored.json` and add the required recap fields below if absent from the template; never edit `source.json`.

## Required authored fields

- `schemaVersion`: `2`.
- `model`: the Codex model selected for the task.
- `authorship`: four non-empty and distinct real agent IDs for analyst, writer, Hebrew editor, and blind reviewer.
- `analysisPlan`: one thesis, 3–5 ranked insights, a two-or-more-source explanatory model, the mandatory historical audit, a narrative arc, 2–4 distinct relevant graphics, all eight coverage decisions, and all quality flags. `playerRoleAttribution` is true only after the analyst has compared unit-level creation/finishing and representative players from both sides.
- Graphic titles and subtitles may describe only fields the selected component actually renders. They contain no numbers; rendered values come from the data component so that copy cannot conflict with rounding or source values. In particular, `tactical_heatmap` renders aggregate team heatmaps, not a named-player trace, shot locations, or unit-creation totals.
- `draftEditorial`: the writer's untouched draft: headline, dek, 3–6 sections, exactly three takeaways, and a conclusion.
- `draftPlayerRecaps`: the writer's untouched array of one recap for every player with `source.players[].minutes > 0`.
- `editorial`: the Hebrew editor's final version in the same shape. Each claim carries one or more valid `evidenceIds`.
- `playerRecaps`: the editor's final array, covering the same played players exactly once, including short appearances and players without a source rating. Use the player-recap contract below.
- `editorialReview`: the writer/editor IDs, hashes of the draft and final copy, at least three concrete edit records, exact coverage of every visible final sentence, `status: "passed"`, and all thirteen checks true.
- `qualityReview`: a distinct reviewer ID, hashes of the final and numberless copy, exact independent coverage of every visible final sentence, a passed numberless read with no issues, all thirteen checks true, `issues: []`, and a positive attempt number.

Use the TypeScript definitions in `src/content/types.ts` when a field is unclear. Use candidate IDs verbatim. A section may reference only insights selected in `analysisPlan.rankedInsights`. Run `npm run content:review-packet -- --authored <authored.json>` after the editor finishes; it prints the hashes, numberless copy, and exact sentence locations that the editor and reviewer must cover.

## Player-recap contract

For every new match review, each entry in `draftPlayerRecaps` and `playerRecaps` has this shape, matching `MatchPlayerRecap` in `src/content/types.ts`:

```json
{
  "playerId": "<exact source player ID>",
  "nameHe": "<verified Hebrew display name>",
  "text": "<one data-backed Hebrew sentence>",
  "evidenceIds": ["player.match.<exact source player ID>"],
  "statCodes": ["<one to three available metric codes supporting the sentence>"]
}
```

- Select a concrete contribution or difficulty from that player's `metrics`; do not force a positive or negative verdict on a brief appearance. A zero must exist in the source, not be inferred from a missing field. Do not turn a single-match observation into a trend.
- Use source identities exactly. Retain accurate Hebrew names; when a source name is in another language, provide a checked Hebrew transliteration in `nameHe` without changing the raw source. Review display names along with the sentences.
- Ratings, minutes, roles, and lineup status render directly from `source.players`; do not add invented rating fields to the recap. The component shows `ללא ציון` for absent ratings. A rating need not be repeated in the sentence.
- Derive focused evidence for authoring and review by importing `matchPlayerRecapEvidence` from `scripts/content_match_player_recaps.mjs` and calling it with `source.players`. Save the result as an ignored workbench sidecar such as `player-recap-evidence.json`. This provides each player's metric values and context under `player.match.<playerId>` without modifying `source.json`; the finalizer independently derives and appends the same evidence.
- The editor writes final `playerRecaps` while preserving `draftPlayerRecaps`. Run postprocessing before producing hashes. `content:review-packet` includes both recap arrays in the draft/final hash calculation and adds exact visible entries for each final name and sentence. Both language reviews must cover the complete packet, not just the newly added text. Concrete edit records may refer to recap sentences.
- `validateMatchPlayerRecaps` checks complete participant coverage, identities, available statistic codes, each player's own evidence, and numeric support. The finalizer runs it automatically. These fields are optional in stored legacy articles for backward compatibility; they are required by this skill for new reviews.

The writer, editor, and reviewer must be fresh-context agents. Give the editor the draft, voice guide, and focused evidence. After the editor finishes visible copy, run `npm run content:postprocess -- --authored <authored.json>` before building hashes, change records, or sentence reviews. The postprocessor changes em dashes to hyphen-minus in the editorial and visible graphic copy; all review artifacts must cover that exact postprocessed text. Give the reviewer the final visible copy and voice guide first; only after its language read should it inspect evidence. Do not show the reviewer the editor's notes or ask it to confirm a prior verdict.

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

The finalizer derives tags from player names used in the article, verifies role separation and review artifacts, stamps candidate generation metadata, recomputes every fact check from the raw source, and writes `.content-workbench/<slug>/candidate.json` only when all checks pass. It remains local and ignored. A finalized candidate is not published and must not appear in the blog index.

Serve the exact candidate with `npm run content:preview -- --candidate <candidate.json>`. The command stages ignored review data and opens the actual blog components in local development mode. Repeat `--candidate` to show several drafts in the article archive. The preview must show `approval.status: pending` and is never a substitute for explicit approval in a later user message.

Publication is a separate promotion step. Run it only after the user explicitly approves the exact candidate in a later message. `content:publish` records the approval note, changes the candidate to published status, and writes `src/content/generated/<slug>.json`. A request to generate, revise, review, preview, finalize, automate, or schedule content is not publication approval.

Never edit stored check results to bypass a failure. Fix the analysis plan or prose and run finalization again.
