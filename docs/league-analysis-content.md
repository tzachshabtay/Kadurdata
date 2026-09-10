# League-analysis drafts

`league_analysis` is a separate article kind. It uses the same blog review UI and explicit publication approval boundary as match reviews, with `league-analysis-v1` as its pipeline version.

Prepare a repository-data snapshot with `matches` from `api_matches` and `players` from `api_match_player_stats`. Player rows must include appearance/player/match/team identity, `formation_position`, `minutes_played` and explicit values for `key_passes`, `total_shots` and `passes_into_final_third`. Fetch every row in the selected window without truncation. The preparation command rejects duplicates, incomplete metrics, nonterminal matches and mixed league/season inputs.

```sh
rtk npm run content:prepare:league -- --raw <query.json> --slug <slug>
rtk npm run content:postprocess -- --authored .content-workbench/<slug>/authored.json
rtk npm run content:review-packet -- --authored .content-workbench/<slug>/authored.json
rtk npm run content:finalize:league -- --source .content-workbench/<slug>/source.json --authored .content-workbench/<slug>/authored.json
rtk npm run content:preview -- --candidate .content-workbench/<slug>/candidate.json
```

Keep the prepared source immutable. An existing source is never overwritten by preparation. Finalization recomputes role totals, appearance-minute denominators and rounded rates from the embedded snapshot, verifies its hash and compares all derived groups and evidence. Missing values are not zeros. Roles describe the provider's position for each appearance, not an inferred movement or tactical sequence.

Use the blog skill's four distinct GPT-6 Astra roles. Authored packages have `schemaVersion: 2`, `kind: league_analysis`, `model`, canonical `authorship`, `aiDisclosure`, the untouched `draftEditorial`, final `editorial`, `analysisPlan`, `editorialReview` and `qualityReview`. The league plan uses a string thesis, 3–5 ranked insights with IDs/evidence IDs, and 2–4 `league_role_comparison` graphics. Each graphic selects `groups`, `metrics`, `layout` (`grouped` or `panels`), `unit: per90` and `placementInsightId`, plus reviewed numberless Hebrew titles/subtitles. Grouped bars share a scale; separate panels show each metric's scale explicitly.

For this kind, native review packets cover the AI disclosure and bind the entire graphic specification as well as final prose. Both reviews must cover every exact sentence and pass the prefix-aware numberless read. Finalization always writes a local `draft` with approval `pending`; it never publishes. `content:publish` remains a separate command requiring later explicit approval of that exact candidate and rechecks league snapshot and review integrity before promotion.
