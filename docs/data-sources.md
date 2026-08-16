# Israeli Soccer Data Sources

Research date: 2026-06-20

Goal: identify queryable sources for Israeli league match data, with emphasis on per-player match statistics that can support visualizations such as pass-completion trends by player.

## Best Current Leads

### 1. 365Scores web API

Status: Queryable, unofficial, very promising for per-match player stats.

League identifier:

- Israeli Premier League: `competitionId=42`

Verified endpoints:

- Competition metadata:
  `https://webws.365scores.com/web/competitions/?appTypeId=5&langId=1&timezoneName=Asia/Jerusalem&competitions=42`
- League player/team aggregate stats:
  `https://webws.365scores.com/web/stats/?appTypeId=5&langId=1&timezoneName=Asia/Jerusalem&userCountryId=6&competitions=42&competitors=&withSeasons=true`
- Fixtures/results:
  `https://webws.365scores.com/web/games/results/?appTypeId=5&langId=1&timezoneName=Asia/Jerusalem&userCountryId=6&competitions=42&startDate=2025-08-01&endDate=2026-05-31`
- Match details:
  `https://webws.365scores.com/web/game/?appTypeId=5&langId=1&timezoneName=Asia/Jerusalem&userCountryId=6&gameId={gameId}&topBookmaker=14`
- Match team statistics:
  `https://webws.365scores.com/web/game/stats/?appTypeId=5&langId=1&timezoneName=Asia/Jerusalem&userCountryId=6&games={gameId}`
- Hebrew player names:
  `https://webws.365scores.com/web/athletes/?appTypeId=5&langId=2&timezoneName=Asia/Jerusalem&userCountryId=6&athletes={athleteIds}`

Observed data:

- Competition metadata: country, season number, active flags, standings/stats/transfers/history support.
- Fixtures/results: game IDs, teams, score/status, start time, round/stage/season fields.
- Match details: lineups, members, officials, venue, top performers, events, chart events, shot chart flags, standings flags.
- Per-player match stats under `game.homeCompetitor.lineups.members[]` and `game.awayCompetitor.lineups.members[]`:
  - minutes, rating/ranking, goals, assists
  - total shots, offsides, key passes
  - passes into final third, backward passes
  - passes completed with percentage, long passes completed with percentage
  - touches, fouls won, fouls made
  - possession lost, final-third possession won
  - clearances, interceptions, ball recoveries
  - goalkeeper saves, penalties saved, goals conceded, expected goals prevented
  - player heatmap URL for many players
- Match team stats: possession, total shots, shots on target, big chances, corners, and more.
- Aggregate player stats currently exposed for the league include: goals, xG, assists, xA, goals+assists, xG+xA, 365 ratings, penalties, tackles won per game, interceptions per game, cards, clean sheets, goals conceded per game, saves per game, penalties saved.
- Source-authored Hebrew player names are available in batches keyed by 365Scores athlete ID.

Pros:

- Direct JSON, no browser required in current tests.
- Has actual per-player match stat lines, including pass completion, which is the core requirement.
- Has heatmap URLs and shot/chart event data for some matches.

Risks:

- Not a documented public developer API.
- Endpoint shape and availability can change.
- Terms/licensing need review before public product use.
- Historical pagination must be tested carefully; the sample results endpoint returned recent/known pages and pagination links.

### 2. football.co.il official site and Parse managed API

Status: Official public site has official league stats; Parse offers a managed API over football.co.il, but it does not currently expose per-match individual player lines.

Useful identifiers:

- Ligat Ha'Al: `tournament_id=902`
- Liga Leumit: `tournament_id=719`

Parse endpoints advertised:

- `get_league_standings`
- `get_fixtures_by_matchday`
- `get_all_teams`
- `get_team_profile`
- `get_team_squad`
- `get_team_fixtures`
- `get_team_statistics`
- `get_match_details`
- `get_match_statistics`
- `get_player_stats_leaders`
- `get_top_scorers`

Observed/advertised data:

- Fixtures, standings, team profiles, squads, team fixtures.
- Match details: teams, score, date, stadium, status.
- Match statistics: team-level in-game stats including goals, xG, passes, possession, shots.
- Season aggregate player leaders: goals, assists, appearances, expected goals, passes, and more.

Pros:

- Closest source to official Israeli league data.
- football.co.il states its official stats are collected under league supervision by third parties and Redwood.
- Managed Parse wrapper has documented endpoint names, rate limits, and health checks.

Risks:

- Parse page explicitly says individual player match-by-match performance is not currently exposed.
- Parse is a paid wrapper, not an official football.co.il developer API.
- Official page warns that statistical collection methodology can differ between providers and can change.

Use:

- Good for cross-checking match calendar, standings, team-level match stats, official aggregates.
- Not sufficient alone for the desired player trend visualizations.

### 3. FotMob public/app endpoints

Status: Rich football data source. Its rendered league pages expose structured
Next.js data, and the current match-id endpoint returns direct JSON.

Known/community endpoints:

- `https://www.fotmob.com/api/matches?date=YYYYMMDD`
- `https://www.fotmob.com/api/matchDetails?matchId={matchId}`
- league page: `https://www.fotmob.com/leagues/127/stats/ligat-haal/players`
- current match details: `https://www.fotmob.com/api/data/matchDetails?matchId={matchId}`
- historical league page: `https://www.fotmob.com/leagues/127/overview/ligat-haal?season=2024%2F2025`

Relevant tooling:

- `worldfootballR` older CRAN release includes FotMob functions for matches by date, match details, match info, match team stats, match players, and season stats.
- `fotmob_get_match_players(match_ids)` is documented as returning match players with nested `stats`.
- `fotmob_get_season_stats()` lists player stat names such as accurate passes per 90, accurate long balls per 90, xG, xA, xGOT, FotMob rating, shots, successful tackles, interceptions, possession won final third, saves, clean sheets, cards.

Pros:

- League pages currently advertise Ligat Ha'Al seasons from 2010/11 onward and
  include full fixture/result lists for a selected historical season.
- Match details are addressable by stable match id; player stats are available
  when that match's coverage level includes ratings/lineups.

- Public UI has many seasons for Ligat Ha'Al.
- Season aggregate stat coverage is broad.
- Community wrappers understand the raw structure.

Risks:

- Unofficial access.
- Direct endpoint behavior appears less reliable now than older examples.
- Need a browser/network inspection pass or maintained wrapper validation before choosing it as a seed source.

Use:

- Candidate secondary/enrichment source, especially for historical aggregate player stats and perhaps match player stats if endpoints can be stabilized.

### 4. SofaScore

Status: Public pages cover the Israeli Premier League, but API requests from the shell returned `403 Forbidden`.

Tournament identifier:

- Israeli Premier League: `uniqueTournament=266`

Observed page data:

- Fixtures, results, standings, season history, team/player pages, player ratings and statistics.

Pros:

- Rich UI and historical league coverage.
- Player pages expose match ratings and career stats.

Risks:

- API access blocked in simple server-side requests.
- Would need browser-based scraping or a separate arrangement, which is brittle.

Use:

- Not first-choice for an automated database seed process unless we later add browser automation or find a stable allowed API path.

## Commercial/API Providers To Evaluate

### API-Football

Status: Paid API, documented, likely good baseline provider.

Coverage page confirms Israel includes:

- Liga Alef
- Liga Leumit
- Ligat Ha'al
- State Cup
- Super Cup
- Toto Cup Ligat Al

Advertised data categories include fixtures, players, standings, events, lineups, statistics, predictions, odds, top scorers.

Potential fit:

- Good for schedules, results, standings, lineups, events, team/player stats.
- Must verify depth for Ligat Ha'Al specifically: per-player match stats may vary by season/fixture.

### Sportmonks

Status: Paid API, documented, broad football coverage.

Advertised data:

- schedules and historical matches
- match statistics and events
- squads, formations, lineups
- live scores, standings, odds/predictions
- coach/referee data
- advanced statistics, including player/team statistics and lineup statistics
- xG add-on for player/team xG metrics

Potential fit:

- Strong candidate if they cover Ligat Ha'Al with the same player-stat depth.
- Need trial/account verification for league ID and exact fields.

### Live-score-api.com

Status: Paid API, documented country coverage.

Israel coverage:

- Cup: `109`
- Leumit League: `177`
- Ligat HaAl: `73`
- Super Cup: `464`
- Toto Cup Ligat Al: `495`

Advertised data:

- fixtures, history, match events, standings, lineups, odds, commentary, match facts, match statistics.

Potential fit:

- Useful for fixture/results/events/lineups.
- Need account verification for per-player match statistics depth.

### Statorium

Status: Paid/custom API.

Israel coverage page lists:

- Premier League
- Liga Leumit
- Israel State Cup
- Israel Toto Cup
- Super Cup

Advertised/pricing mentions:

- starting lineups
- live scores
- live player stats
- after-match team stats

Potential fit:

- Worth contacting if commercial licensing is desired.
- Need quote and sample payloads for Ligat Ha'Al per-player match data.

### Goalserve

Status: Paid API, XML/JSON.

Coverage includes Israeli competitions with:

- live scores
- live stats/lineups
- results/schedules
- odds
- profiles

Potential fit:

- Good commercial candidate for live data.
- Need sample payload for Israeli Premier League player match stats.

### TheStatsAPI

Status: Paid API with free trial.

Advertised:

- match results, fixtures, season history
- most competitions include full player stats, team stats, odds, xG
- match stats endpoint includes possession, shots, passes, corners, cards, xG

Potential fit:

- Good if Ligat Ha'Al is covered by default or available by request.
- Need coverage confirmation for Israel and exact per-player match fields.

### Opta / Stats Perform, Wyscout, InStat, Hudl StatsBomb

Status: Enterprise/professional data vendors.

Notes:

- 365Scores has publicly announced Stats Perform as a data partner for premium sports data including game tracking, player stats, and real-time updates.
- Israeli media and league materials refer to Redwood collecting, analyzing, and distributing league stats on behalf of the league.
- Research/scouting articles cite Wyscout/InStat/Opta data for Israeli football analyses.

Potential fit:

- Best quality and licensing clarity if budget allows.
- Likely expensive and sales-led.

## Initial Recommendation

Use a two-track source strategy:

1. Prototype ingestion with 365Scores as the main player-match source, because it currently exposes per-player match lines with pass completion and many other useful metrics.
2. Use football.co.il/Parse as the official-ish cross-check source for fixtures, team stats, standings, squads, and season aggregates.

Before designing the database, run a small spike:

- Pull every 2025/26 Ligat Ha'Al fixture from 365Scores.
- For each finished match, pull `web/game` and `web/game/stats`.
- Flatten lineups into player-match rows.
- Parse compound stat values like `29/34 (85%)` into made/attempted/percentage fields.
- Compare a subset of fixtures and team stats against football.co.il/Parse.
- Record missing fields by match and by player.

If the product is intended for public/commercial release, evaluate Sportmonks, API-Football, Goalserve, Statorium, TheStatsAPI, and possibly Stats Perform/Wyscout before committing to unofficial sources.

## 365Scores Spike Result

Run date: 2026-06-20

Implemented:

- `scripts/ingest_365scores.py`
- Raw cache under `data/raw/365scores/`
- Processed CSVs under `data/processed/`

Command:

```bash
python3 scripts/ingest_365scores.py
```

Initial output:

- Fixtures returned by the current endpoint: 72
- Match detail payloads fetched: 72
- Match team-stat payloads fetched: 72
- Player-match rows flattened: 3,494
- Team-stat rows flattened: 5,834
- Fetch failures: 0
- Season number observed: 88
- Stage numbers observed: 1, 2
- Round numbers observed: 1-10, 25, 26, 31-33

The player-match payloads contain usable stat keys for trend analysis:

- passing: passes completed, long passes completed, passes into final third, backward passes, key passes, crosses completed
- attacking: goals, assists, expected goals, expected assists, xGOT, shots on/off target, blocked shots, big chances created/missed/scored
- possession/duels: touches, possession lost, successful dribbles, aerial duels won, ground duels won, was fouled
- defensive: tackles won, interceptions, clearances, ball recovery, final-third possession won, fouls made, was dribbled past
- goalkeeper: saves, goals conceded, penalties saved, expected goals prevented, xGOT conceded, high claims, punches, played sweeper

Example parser behavior:

- Raw value: `14/22 (64%)`
- Flattened fields:
  - `stat_passes_completed_value=14`
  - `stat_passes_completed_attempted=22`
  - `stat_passes_completed_percentage=64`

Follow-up pagination result:

- The ingestion script now follows normalized `/web/games/` paging links, deduplicates by `game_id`, and filters back to the requested date window.
- Fixtures discovered for 2025-08-01 through 2026-05-31: 240
- Match detail payloads fetched: 240
- Match team-stat payloads fetched: 240
- Player-match rows flattened: 11,360
- Team-stat rows flattened: 19,232
- Fetch failures: 0
- Season number observed: 88
- Stage numbers observed: 1, 2
- Round numbers observed: 1-26, 31-33

This looks like complete 2025/26 Ligat Ha'Al coverage: 182 regular-season matches plus 58 playoff matches.
