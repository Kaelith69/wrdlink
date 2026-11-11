# WRDLINK Terms and Conditions

_Last updated: 11 November 2026_

These Terms govern use of WRDLINK, a word transformation puzzle game made available through Reddit and powered by Reddit Devvit. By accessing or playing WRDLINK, you agree to these Terms. If you do not agree, do not use the game.

These Terms apply to WRDLINK only. Your use of Reddit and Devvit is also governed by the applicable Reddit user agreement, privacy policy, developer platform terms, and community rules.

## 1. Who provides WRDLINK

WRDLINK is a game application made available within Reddit. It is not an independent Reddit service, and it is not sponsored or endorsed by Reddit unless Reddit expressly states otherwise. Reddit provides the platform and hosting environment through Devvit and controls its own platform services and policies.

## 2. Eligibility and account

You may use WRDLINK only if you are eligible to use Reddit under Reddit's applicable age requirements and terms. You are responsible for activity carried out through your Reddit account and for keeping access to your device and browser session secure.

Campaign recovery and ranked daily challenge features use the authenticated Reddit account identifier supplied to the server by Devvit. Daily leaderboard entries display the player's public Reddit username. Logged out players may play the daily puzzle, but their results are not ranked or stored in a persistent player profile.

## 3. Gameplay and scoring

WRDLINK is a word transformation game. Players attempt to reach a target word by submitting valid words according to the displayed puzzle rules and the game's embedded dictionary.

The server validates submitted moves and maintains the authoritative campaign score and word chain. The current scoring rules are:

- A new campaign starts with **25 points**.
- **Every submitted move costs 1 point**, whether the move is valid or invalid, when the submission reaches move validation for an active puzzle.
- A rejected move does not become part of the accepted word chain.
- Completing a level awards **25 points**.
- The score carries into the next level and cannot fall below zero.
- A confirmed hint costs its current escalating hint price **plus the normal 1 point move cost**. The first hint price is 5 points, so its initial total deduction is 6 points. Each later hint price increases by 1 point.
- Hints are unavailable when the current score cannot cover the full hint and move deduction.

Rate limited requests, malformed requests rejected before move validation, and requests for unavailable or completed sessions are not accepted gameplay moves and do not incur the move deduction.

### Daily challenge, rankings, streaks, and sharing

- The daily challenge is shared by players in the same installed subreddit and changes at 00:00 UTC. Daily mode starts at 25 points, deducts one point per submitted move, awards 25 points on completion, and disables hints for ranked runs.
- Daily, weekly, and all time leaderboards are calculated from server validated daily completions. A player can submit only one ranked completion per day.
- Daily rankings prioritize highest score or fewest moves. Ties are resolved deterministically using the other result metric, completion time, and stable account ordering.
- Weekly and all time community rankings aggregate verified daily completions. Leaderboards are scoped to the subreddit installation where WRDLINK is installed; they are not global across every subreddit installation.
- Daily streaks increase on consecutive UTC challenge days. One missed day can be protected by a grace token. Grace tokens are earned after seven consecutive completed days and are capped at two.
- Achievement badges are based on server recorded completion milestones, optimal move paths, and streak milestones.
- Sharing a verified result is optional. Selecting Share as Reddit post or Share as comment explicitly publishes the result under your Reddit account. Shared results are visible according to Reddit's normal post and comment visibility settings.

Scores, levels, hints, daily results, streaks, badges, and leaderboard positions are game progress only. They have no cash value, are not prizes, and do not represent a guarantee of reward or eligibility for anything outside the game.

## 4. Campaigns and saved progress

Campaign progress is stored by the server in Reddit Devvit Redis. Session records and associated account mapping records are configured to expire after 7 days without an update. Daily challenge sessions and daily and weekly result records expire after 60 days. All time leaderboard and player progression records persist until removed with the app data. Progress may therefore be lost after inactivity, service changes, technical failures, or expiration.

Signed in Reddit players may be able to restore a campaign through the account mapping maintained by the server. Logged out campaigns depend on browser session storage and the corresponding server session. We do not guarantee permanent storage, uninterrupted availability, or recovery in every circumstance.

Starting a new campaign resets the active campaign's score, level, puzzle, word chain, and hint count. It is not an immediate deletion control for all related server records.

## 5. Acceptable use

You agree not to:

- Use WRDLINK in violation of applicable law or Reddit's terms and policies.
- Attempt to gain unauthorized access to the game, its server, Redis data, or another player's campaign.
- Interfere with, overload, disrupt, or impair the game or its hosting services.
- Probe, exploit, or abuse vulnerabilities, rate limits, or other technical controls.
- Use automation or other means to disrupt normal game operation or other players' access.
- Misrepresent scores, results, or game activity.

We may restrict access or take other reasonable steps where necessary to protect the game, its users, or the hosting platform.

## 6. Game content and changes

Puzzle generation, dictionary contents, validation rules, scoring, hints, and other game features may change as WRDLINK is maintained. The game may contain errors, unavailable words, imperfect puzzle generation, or temporary service interruptions.

We may update, suspend, or discontinue all or part of WRDLINK at any time. We do not guarantee that a particular puzzle, feature, score, or campaign will remain available.

## 7. Third party services

WRDLINK depends on Reddit and Devvit, including Devvit's hosting and Redis services. Those services are controlled by their respective providers and may be subject to separate terms, availability limits, and privacy practices. WRDLINK is not responsible for independent services or policies controlled by third parties.

## 8. Disclaimer and limitation

WRDLINK is provided on an **“as is”** and **“as available”** basis to the extent permitted by applicable law. We do not warrant that the game will be uninterrupted, secure, error free, compatible with every device, or that saved progress will always be preserved.

To the extent permitted by applicable law, WRDLINK and its maintainers are not liable for indirect, incidental, special, consequential, or punitive losses arising from use of, inability to use, or loss of progress in the game. Nothing in these Terms excludes or limits liability where doing so would be unlawful, or limits rights that cannot legally be waived.

## 9. Changes to these Terms

These Terms may be revised when the game, its features, or its operation changes. The latest version will be published in this repository with an updated date. Continued use after revised Terms are published constitutes acceptance to the extent permitted by applicable law.

## 10. Contact

For questions about WRDLINK, contact the moderators of the subreddit where you accessed the game through Reddit modmail.

## 11. No legal advice

These Terms describe the current game and are not legal advice. They do not replace Reddit's terms, policies, or any rights that apply under local law.
