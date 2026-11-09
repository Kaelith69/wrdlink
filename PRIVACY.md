# WRDLINK Privacy Policy

_Last updated: 9 November 2026_

This policy explains what the current WRDLINK application code handles when you play the game on Reddit.

## Information the app handles

**Session identifier.** The game creates a random session identifier in the browser using `crypto.randomUUID()` when available, with a generated fallback. It is stored in browser `sessionStorage` under the key `wrdlink-session` so the game can reconnect to the same session during that browser tab's page session.

**Game session data.** The server stores the following session state: current puzzle data (including its identifier, start word, target word, word length and optimal move count), level number, cumulative game score, submitted word chain, completion state, and campaign hint count.

**Submitted words.** When you submit a move, the client sends the session identifier, puzzle identifier, and candidate word to the WRDLINK server for validation. The server stores the accepted word chain in the Redis session record so your progress can be restored during the session retention period.

## Where information is stored

The server uses Reddit Devvit's Redis service. Session records are stored under a key derived from the session identifier. Each session record expires after **7 days** without an update. The app does not provide an in-game control to delete a session record before expiry.

The server depends on Devvit Redis for session persistence. If Redis is unavailable, requests can fail temporarily and the app displays a service error. There is no in-memory fallback.

For signed in Reddit users, the server also stores a mapping from the authenticated Reddit account ID to the campaign session ID. This account ID is supplied by Devvit's server context, not by the browser. The mapping allows campaign recovery across tabs and browser sessions. The account ID is used only as the Redis key for this mapping. The mapping expires after 7 days without activity and is refreshed when the campaign is used. The browser session identifier remains in `sessionStorage` as a compatibility and logged out fallback.

## Reddit account information

The current WRDLINK application does not request or store your Reddit username, email address, or profile information. For signed in players, Devvit provides an authenticated Reddit account ID to the server. WRDLINK uses that ID as the key for the account to campaign mapping described above. It does not store the ID as a profile field or display it in the game. It does not include a leaderboard, advertising tracker, analytics SDK, or external tracking integration in the code reviewed for this policy.

Reddit and Devvit may independently process information as part of operating the Reddit platform and hosting Devvit apps. Their processing is governed by Reddit's own terms and privacy policy.

## Sharing

The current app code does not send the game session record or submitted word chain to an external analytics or advertising provider. Session data is written to Devvit Redis as described above. Reddit/Devvit necessarily provides the platform and storage services on which the app runs.

## Retention and deletion

The app does not currently implement a user-facing session deletion feature. Session records automatically expire after 7 days without an update. Redis rate limit counters expire after 60 seconds. The browser's session identifier remains in session storage for the lifetime of that browser tab session and may be cleared by closing the tab or clearing site data.

Signed in players' campaign sessions are associated with their authenticated Reddit account ID through the expiring mapping. Logged out sessions remain browser session based. The app does not currently implement a user facing session deletion feature. For questions or requests relating to WRDLINK data, contact the moderators of the subreddit where you used the game through Reddit modmail. Requests concerning data processed by Reddit itself should be directed to Reddit through its privacy controls and policies.

## Changes to this policy

This policy will be updated if the app's data handling changes. The latest version will be published at this URL.

## Contact

For WRDLINK privacy questions, contact the moderators of the subreddit where you accessed the game through Reddit modmail.
