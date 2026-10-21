# Daily article selection

## Window

Start immediately after the most recent successful daily candidate generation. Inspect every newly completed eligible match. Never select a match that already has a published article or an awaiting-review candidate.

If no prior daily run can be found, inspect the previous completed calendar day in Israel. Do not include a match that is still live, postponed, or missing the core data required by its article type.

## Match priority

The priority clubs are:

1. מכבי תל אביב
2. מכבי חיפה
3. בית״ר ירושלים
4. הפועל באר שבע
5. הפועל תל אביב

Rank candidates in tiers:

1. a match between two priority clubs;
2. a match involving one priority club;
3. another match involving an Israeli club.

Within the highest non-empty tier, prefer the match with the strongest editorial potential. Score the evidence, not the fame: major game-state turns, a misleading final stat line, a sharp gap between shot volume and quality, a comeback, a tactical or role anomaly, strong player-level explanations, and complete data all increase interest. Record why the winner beat the other candidates.

Every completed match between two priority clubs requires its own article. Keep uncovered fixtures in `.content-workbench/priority-match-backlog.json` with match ID, date, status and any concrete blocker; inspect this backlog even when a fixture predates the current selection window. Exclude published or pending candidates. Respect the caller's per-run candidate limit, but retain the remaining priority fixtures for subsequent runs instead of losing them when the successful-generation boundary advances.

On initialization, a missing backlog, or a season change, backfill every completed priority-versus-priority fixture in the current season from repository data. Reconcile each match ID against published articles and pending candidates before adding uncovered fixtures. Record the audited season and time, then merge newly completed fixtures on subsequent runs. The rolling selection window must never be the only discovery source for mandatory coverage.

A source inconsistency is an investigation task, not a reason to silently replace a priority-versus-priority fixture with a lower-tier article. Re-query the source and investigate event-level primary reporting. A documented goal-line clearance, for example, can reconcile a blocked event with the shots-on-target total using the existing exact-event registry and a regression test. Never infer a correction merely because a total is short, edit immutable raw data, or weaken a check. If the inconsistency cannot be resolved with verified evidence, retain the fixture as blocked in the backlog and report the exact unresolved fact. Do not treat it as covered.

## No-match fallback

If there is no eligible match, investigate an Israeli-league topic from the available repository data. Examples include a sustained change in a team's style, a player's improvement or decline in a high-volume role metric, a position-group comparison, a league-wide tactical contrast, a shot or creation profile, or a historical comparison with a like-for-like window. These are research directions, not automatically publishable premises.

Do not treat examples as fixed templates. Search the available data first and choose the question with the clearest reader value. If the season or player sample is too short for a trend claim, change the question rather than stopping: aggregate across the league, compare position or role groups, use a clearly labelled early-season snapshot, widen to a like-for-like historical window, or find another current data-backed angle. Match the strength of the language to the sample and avoid league tables made from one-off goals or assists.

Before drafting, write the story brief in [story-first.md](story-first.md). For each serious contender record its question, supported answer, football consequence and decisive evidence; explain why the winner offers more than familiar roles or a table of totals. Broaden or reframe a weak lead, but stop without a candidate if no defensible story survives. Record concrete rejection reasons and keep the last successful generation boundary unchanged so the next run retains coverage.

## Output

For a match, hand off to the match-review skill. For a league topic, use the same four-role, story, evidence, Hebrew-editing, graphics, fact-checking, local-preview, and approval gates. A successful run ends with a local draft candidate awaiting approval, never publication. Otherwise retain the research and explain why no topic cleared the gates.
