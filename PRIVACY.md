# WRDLINK Privacy Policy

_Last updated: 9 November 2026_

This policy describes the information handled by the WRDLINK game when it is used through Reddit. It describes the current application implementation, not every category of information Reddit may process as the platform provider.

## 1. Information WRDLINK handles

### Game and session information

WRDLINK creates a random browser session identifier, using `crypto.randomUUID()` when available and a generated fallback otherwise. The identifier is stored in browser `sessionStorage` under `wrdlink-session`. Browser session storage is scoped to the tab's page session and is not a Reddit account credential.

The game server stores campaign state in Reddit Devvit Redis. This includes:

- The current puzzle identifier and puzzle data, including its start word, target word, word length, and optimal move count.
- The campaign level and cumulative score.
- The accepted word chain.
- Whether the current puzzle is complete.
- The number of hints used during the campaign.

### Submitted words and gameplay actions

When a player submits a move, the server receives the session identifier, puzzle identifier, and candidate word so it can validate the move and apply the scoring rules. A submitted move costs one point whether it is accepted or rejected, provided it reaches the server's move validation flow for an active puzzle. The candidate word from a rejected move is not added to the saved word chain. Accepted words are stored as part of campaign progress.

A confirmed hint is processed by the server. The hint count and updated campaign state are stored. The hint price increases with each hint, and the normal one point move cost is included in the hint's total deduction.

### Reddit account identifier and daily profile

For signed in Reddit players, Devvit supplies an authenticated Reddit account identifier to the server. WRDLINK uses it to associate campaign and daily challenge state with the account, prevent duplicate daily leaderboard submissions, and scope authenticated rate limits. The identifier is not supplied by the browser.

For daily leaderboards, WRDLINK stores the player's public Reddit username, daily completion date, start and target words, accepted word chain, move count, server calculated score, completion timestamp, total daily completions, cumulative score and moves, streak, grace token balance, and earned achievement identifiers. The username and daily result are displayed in the community leaderboard. WRDLINK does not request an email address or private profile information.

Logged out play uses the browser session identifier for temporary daily puzzle state. Logged out completions are not added to ranked leaderboards and do not create a persistent player profile.

### Operational and rate limit information

The server maintains short lived rate limit counters to protect the game from excessive requests. These counters are keyed to the authenticated account for signed in players or to the session for logged out play. Rate limit counters are configured to expire after 60 seconds.

The server also uses a short lived Redis lock while updating campaign state, to prevent concurrent requests from overwriting one another. The lock is temporary operational state, not a player profile.

## 2. How information is used

WRDLINK uses the information above only to:

- Load and restore a player's campaign.
- Provide one shared daily puzzle to players in the installed subreddit.
- Validate daily completions and calculate daily, weekly, and all time community rankings.
- Maintain daily streaks, grace tokens, and achievement badges.
- Display public leaderboard entries and player progression.
- Share a verified daily result to Reddit only after the player explicitly selects the post or comment sharing action.
- Validate submitted word chains against the game's rules and embedded dictionary.
- Calculate move deductions, hint costs, and level completion rewards.
- Prevent duplicate or conflicting campaign updates.
- Apply request rate limits and protect service availability.
- Diagnose service errors and maintain the game.

## 3. Storage and service providers

Campaign data, daily challenge sessions, verified completion records, player profiles, leaderboard indexes, account mappings, rate limit counters, and temporary session locks are stored using Reddit Devvit Redis.

WRDLINK runs on Reddit's Devvit platform. Reddit and Devvit may process information independently to provide, secure, and operate Reddit and its developer platform. That processing is governed by Reddit's own terms, privacy policy, and platform rules. This policy does not replace those documents.

A player can explicitly choose to share a verified daily result as a Reddit post or comment. Those actions are submitted as the player's Reddit account, not automatically. A shared result includes the daily date, start and target words, accepted word chain, move count, score, and a link to the WRDLINK community.

The current WRDLINK application code does not integrate a separate advertising network, analytics SDK, or external word definition service. This statement describes the application code and should not be read as a promise about platform level processing by Reddit.

## 4. Retention

- Campaign session records expire after **7 days without an update**. Successful campaign interactions refresh the session expiry.
- Signed in account to campaign mappings are configured to expire after **7 days** and are refreshed when the account campaign is resolved or used.
- Session ownership records are temporary Redis records with a **7 day** expiry, refreshed when the account campaign is resolved.
- Daily challenge sessions, daily completion records, and daily and weekly leaderboard records are configured to expire after **60 days**.
- All time player profiles and all time leaderboard records persist until the app or its data is removed.
- Rate limit counters expire after **60 seconds**.
- Session update locks are temporary and use a **60 second** lease.
- The browser session identifier remains in session storage for the lifetime of the browser tab's page session, subject to browser behavior and user clearing site data.

These are application configured expiry periods. Reddit or Devvit may retain platform operational records under their own policies.

## 5. Access, deletion, and campaign reset

WRDLINK currently does not provide an in game control to delete a Redis campaign record immediately. Starting a new campaign resets the active campaign state, but it should not be treated as an immediate deletion request for every related Redis record. Expiring session, account mapping, ownership, rate limit, and lock records are removed according to their configured expiry behavior.

For questions or requests concerning WRDLINK campaign data, contact the moderators of the subreddit where you used the game through Reddit modmail. Requests about information processed by Reddit or Devvit should be directed to Reddit through its privacy controls and policies.

## 6. Security and limitations

WRDLINK uses server side validation, account linked campaign sessions for signed in players, request rate limits, and serialized session updates. No internet service can guarantee absolute security or uninterrupted availability. Session continuity may be affected by Redis availability, expiry, browser session storage, or changes to the game.

A browser session identifier is a session credential for logged out play. Do not share it if you do not want another person with access to that browser session to interact with its campaign.

## 7. Children and eligibility

WRDLINK is provided through Reddit. Users must meet Reddit's applicable age requirements and comply with Reddit's terms and policies. WRDLINK does not independently verify a player's age.

## 8. Changes to this policy

This policy may be updated when the game's functionality, data handling, or platform integration changes. The latest version will be published in this repository.

## 9. Contact

For WRDLINK privacy questions, contact the moderators of the subreddit where you accessed the game through Reddit modmail.
