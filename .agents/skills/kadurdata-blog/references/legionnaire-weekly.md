# Weekly legionnaire summary

## Reporting window

Use the most recent seven fully completed calendar days in Israel. Query the current foreign-club season, then collect every appearance by an Israeli legionnaire in the window. Deduplicate the same fixture when two imported competition records describe it.

Report how many players appeared, how many appearances they made, and the total recorded minutes. Separate full-stat appearances from rows that contain only minutes/goals/assists so missing detail is not mistaken for zero activity.

## Analysis

The weekly article is a complete, player-by-player report. It must include every legionnaire who recorded at least one minute in the reporting window. Sort player blocks by the weekly minutes-weighted `rating_365` from highest to lowest; players without a rating come last, ordered by minutes and then Hebrew name. Never drop a player because the detailed provider feed is incomplete.

Open with a short weekly overview, then give every player one compact block. Before the prose, show a code-native stat card containing the player's rating, minutes, and the most useful available role-specific basics. Do not display unavailable metrics as zero. Inspect:

- minutes and starts;
- touches and passing involvement;
- passes into the final third and key passes;
- shots, xG and xA;
- dribbles and fouls won;
- duels, tackles, recoveries, interceptions and clearances;
- goalkeeper shot-stopping metrics when relevant.

Compare each player only with his own prior appearances, never with another player. Use up to five prior appearances in the same season and per-90 values for volume metrics. Require at least three prior appearances of 30 minutes or more, a meaningful deterministic delta, and enough prior volume before using progress, decline, or role-change language. Goals, assists, ratings, and a one-match swing may introduce a performance but cannot establish a trend by themselves. If the sample is insufficient or no meaningful change exists, describe the week without forcing a trend claim.

Each player's prose should interpret the card rather than repeat it. Explain what his involvement, efficiency, defensive work, or chance volume says about his own match. For basic-only appearances, state only supported facts and keep the paragraph brief. Do not compare players to each other, rank them in the prose, or turn the article into a stream of disconnected numbers.

## Player cards and graphics

The repeated player stat cards are the primary graphics for this article. Every card must precede its player's paragraph and show:

- rating and minutes;
- appearances when the player played more than once;
- goals or assists when nonzero;
- goalkeeper metrics such as saves or prevented goals when available;
- defender metrics such as pass completion, tackles, duels and clearances when available;
- midfielder metrics such as completed passes, passes into the final third, key passes and recoveries when available;
- attacker metrics such as shots, shots on target, xG, xA and successful dribbles when available.

Use at most four supporting stats beyond rating and minutes, and prefer the ones that help explain the paragraph. Cross-player bar charts, leaderboards, and comparison graphics are forbidden in the weekly article. A current-versus-own-baseline visual may be added only when the sample rules above are satisfied and it materially clarifies the player's paragraph; it is optional.

Record the chosen supporting fields in each final `playerRecaps[].statCodes` array. Use metric codes from that player's weekly source record or the supported derived codes `appearances`, `starts`, `match_result`, and `pass_completion`. The card must include `appearances` whenever the player appeared more than once. The editor must verify that the chosen fields directly support the point made in the paragraph.

## Workflow

1. Run `npm run content:prepare:legionnaires -- [--end-date YYYY-MM-DD]`.
2. Inspect the generated `source.json`, especially duplicate removals, data completeness, baselines, and deterministic insight candidates.
3. The analyst completes the plan and creates one `playerRecaps` entry, in source order, for every player with minutes.
4. A fresh writer writes `draftEditorial` and all `playerRecaps`.
5. A fresh Hebrew editor writes `editorial` and edits every `playerRecaps` entry, then run `npm run content:postprocess -- --authored <authored.json>`.
6. Run `npm run content:review-packet -- --authored <authored.json>` and record exact hashes and sentence coverage.
7. A fresh blind reviewer first reads the final visible copy without the editor notes, then checks every claim against `source.json`.
8. Run `npm run content:finalize:legionnaires -- --source <source.json> --authored <authored.json>`.
9. Run `npm run content:preview -- --candidate <candidate.json>` and stop for approval.

Never publish from a scheduled run.
