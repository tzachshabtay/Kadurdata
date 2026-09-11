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

## Comparing clubs

Preparation accepts `--club-names <verified-id-to-Hebrew-name.json>` and optional `--player-names <verified-id-to-Hebrew-name.json>`. For a revision of an existing snapshot, `addLeagueClubComparison(source, clubNames, playerNames)` returns a new source package; write it into a new workbench directory and preserve the previous source. The snapshot and its hash remain unchanged. Names must be verified against repository metadata.

The optional `clubComparison` extension derives every club's role totals, player minutes, rates, share of all club actions, per-match breakdowns and pooled rest-of-league comparison. The rest excludes the focal club. Missing role minutes yield a null rate, never zero; all club appearances contribute to share denominators, even roles omitted from a graphic. Named player evidence is independently derived from the same appearances. Source validation recomputes the entire extension and its evidence.

Use `league_club_comparison` graphics with `layout: "matrix"`, `clubs` (team IDs), `groups` (role IDs), `metrics`, and `unit: "per90"` or `"team_share"`. Optional `highlightClubId` highlights a displayed club; `includeRest: true` adds a pooled baseline for a single focal club. Single-club charts render grouped role bars; comparisons render labeled tables with exposure shown for single-role rankings. Cite `club.<teamId>.position.<role>` for every displayed cell and `rest.<teamId>.position.<role>` for each baseline cell. Do not include overlapping roles, such as fullbacks alongside left-backs. Graphic specifications are included in review hashes.

Compare all clubs before choosing a focal example. Check actual role minutes, player concentration and each fixture's contribution before turning an early-season outlier into the story. A repeat contribution across a few games supports a short-window observation, not a settled playing style. Keep the narrative about the players and football; put detailed robustness checks in the internal analyst record.

## Comparing individual left-backs

`addLeaguePlayerComparison(source, rawSupplement, verifiedPlayerNames, minimumMinutes = 180)` adds a separate `playerComparison` extension; save its result into a new workbench directory. The original attacking snapshot stays immutable. The supplement must carry the original `snapshotHash`, query timestamp and `api_match_player_stats` rows. Every selected defensive metric must be present explicitly for every original positive-minute appearance labeled `Left Back`. Identity, team, match, position, minutes, provider, duplicates and metric values are checked. Missing metrics fail preparation; absence is never converted to zero.

The extension currently supports the fully covered count families `ball_recovery`, `clearances`, `fouls_made`, `interceptions` and `was_dribbled_past`, alongside the original attacking metrics. It hashes the normalized supplement and recomputes player totals, rates and eligible-peer baselines during source validation. A player's other-position appearances are excluded. The minimum-minute rule uses full appearance minutes according to the provider's role label, not measured time physically spent at left-back. Each pooled baseline excludes both the focal player and players below the threshold.

Use `league_player_comparison`, `layout: "matrix"`, `unit: "per90"`, `playerIds`, a displayed `highlightPlayerId`, and one to four supported `metrics`. Set `groups: []` for this graphic type. Every displayed player must meet the source threshold and have `peer.<playerId>` evidence; also cite `peer.scope`. Optional prose comparisons with pooled eligible peers cite `peer.rest.<playerId>`. The renderer displays names, clubs, sample minutes and per-column metric labels, with a distinct color for times dribbled past. It does not compute an overall defensive score.

An individual-focused profile should consider defensive evidence as well as attacking output. Compare the same window, disclose the sample threshold concisely, and distinguish recoveries from interceptions. Action counts reflect opportunities and team context as well as performance; times dribbled past without attempts faced is a count, not a failure percentage. Incomplete tackles/duels cannot support a zero or an invented success rate. Keep these limits in the interpretation and brief graphic notes, while the prose tells the football story.
