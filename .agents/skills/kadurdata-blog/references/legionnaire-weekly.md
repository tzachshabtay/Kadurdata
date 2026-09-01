# Weekly legionnaire summary

## Reporting window

Use the most recent seven fully completed calendar days in Israel. Query the current foreign-club season, then collect every appearance by an Israeli legionnaire in the window. Deduplicate the same fixture when two imported competition records describe it.

Report how many players appeared, how many appearances they made, and the total recorded minutes. Separate full-stat appearances from rows that contain only minutes/goals/assists so missing detail is not mistaken for zero activity.

## Analysis

Build the article around one answerable weekly question rather than a player-by-player roll call. Inspect:

- minutes and starts;
- touches and passing involvement;
- passes into the final third and key passes;
- shots, xG and xA;
- dribbles and fouls won;
- duels, tackles, recoveries, interceptions and clearances;
- goalkeeper shot-stopping metrics when relevant.

Compare a highlighted player with up to five prior appearances in the same season. Use per-90 values for volume metrics, require at least three prior substantial appearances for trend language, and distinguish a changed role from a single good result. Goals and assists may introduce the story but cannot establish the trend by themselves.

Prefer two to four connected subjects. Mention the remaining active legionnaires in a concise roundup only when it improves completeness; do not dump every available number into the body.

## Graphics

Choose two or three code-native graphics from the weekly data after the thesis is set:

- workload: minutes and appearances for the active group;
- role comparison: the same high-volume metric for selected players;
- current-versus-baseline: a selected player's weekly per-90 value against the prior-appearance average.

Each graphic must visualize a claim already explained in the article and cite the same evidence. Do not render an empty comparison when the baseline sample is too small.

## Workflow

1. Run `npm run content:prepare:legionnaires -- [--end-date YYYY-MM-DD]`.
2. Inspect the generated `source.json`, especially duplicate removals, data completeness, baselines, and deterministic insight candidates.
3. The analyst completes the plan in `authored.json`.
4. A fresh writer writes `draftEditorial`.
5. A fresh Hebrew editor writes `editorial`, then run `npm run content:postprocess -- --authored <authored.json>`.
6. Run `npm run content:review-packet -- --authored <authored.json>` and record exact hashes and sentence coverage.
7. A fresh blind reviewer first reads the final visible copy without the editor notes, then checks every claim against `source.json`.
8. Run `npm run content:finalize:legionnaires -- --source <source.json> --authored <authored.json>`.
9. Run `npm run content:preview -- --candidate <candidate.json>` and stop for approval.

Never publish from a scheduled run.
