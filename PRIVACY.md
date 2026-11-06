# WRDLINK Privacy Policy

_Last updated: 7 November 2026_

This policy explains what the current WRDLINK application code handles when you play the game on Reddit.

## Information the app handles

**Session identifier.** The game creates a random session identifier in the browser using `crypto.randomUUID()` when available, with a generated fallback. It is stored in browser `sessionStorage` under the key `wrdlink-session` so the game can reconnect to the same session during that browser tab's page session.

**Game session data.** The server stores the following session state: current puzzle data (including its identifier, start word, target word, word length and optimal move count), level number, cumulative game score, and whether the puzzle is completed.

**Submitted words.** When you submit a move, the client sends the session identifier, puzzle identifier, and current word chain to the WRDLINK server for validation. The current server code validates the submitted chain but does not save the submitted word chain as part of the session record.

## Where information is stored

The server uses Reddit Devvit's Redis service. Session records are stored under a key derived from the session identifier. The current code does not set a Redis expiration time (TTL) and does not provide an in-game control to delete a session record. Redis retention and deletion are therefore subject to the Devvit platform's operation and policies.

If a Redis read or write fails, the server uses an in-memory fallback. In-memory session data is lost when that server process stops or restarts.

The browser session identifier is held in browser `sessionStorage`, rather than a permanent account profile or a WRDLINK account.

## Reddit account information

The current WRDLINK application code does not request or store your Reddit username, email address, profile information, or Reddit account identifier. It does not include a leaderboard, advertising tracker, analytics SDK, or external tracking integration in the code reviewed for this policy.

Reddit and Devvit may independently process information as part of operating the Reddit platform and hosting Devvit apps. Their processing is governed by Reddit's own terms and privacy policy.

## Sharing

The current app code does not send the game session record or submitted word chain to an external analytics or advertising provider. Session data is written to Devvit Redis as described above. Reddit/Devvit necessarily provides the platform and storage services on which the app runs.

## Retention and deletion

The app does not currently implement a user-facing session deletion feature or an automatic Redis expiry. A session record may remain in Devvit Redis until it is overwritten or removed under the platform's storage lifecycle. The browser's session identifier remains in session storage for the lifetime of that browser tab session and may be cleared by closing the tab or clearing site data.

Because the current app does not associate session records with a Reddit account, the app cannot identify a session by username. For questions or requests relating to WRDLINK data, contact the moderators of the subreddit where you used the game through Reddit modmail. Requests concerning data processed by Reddit itself should be directed to Reddit through its privacy controls and policies.

## Changes to this policy

This policy will be updated if the app's data handling changes. The latest version will be published at this URL.

## Contact

For WRDLINK privacy questions, contact the moderators of the subreddit where you accessed the game through Reddit modmail.
