# WRDLINK standalone

A dependency free HTML, CSS and JavaScript browser edition of the WRDLINK word transformation game.

## Run

Open `index.html` in a modern browser. No build step or server is required.

## Files

- `index.html` is the accessible game shell.
- `styles.css` contains the responsive dark interface.
- `app.js` implements puzzle generation, shortest path search, move validation, scoring, progression and local progress persistence.
- `dictionary.js` contains the original 3,889 word dictionary from the Devvit server source.

## Original rules preserved

- Each word is exactly four letters.
- Every move changes exactly one letter.
- Every word must exist in the bundled dictionary.
- A word cannot be reused in the same chain.
- The target must be the final word in the chain.
- Invalid moves do not advance the chain or consume a move.
- A fresh level is worth 50 points, reduced by one point per move, with a floor of zero.
- Level scores accumulate. Starting a new game resets the score and level.
- Puzzles are generated from dictionary paths. Breadth first search computes the minimum route length, but valid nonoptimal routes are allowed.

## Platform differences

The Reddit Devvit server, Redis session state and API endpoints are replaced with local browser execution and localStorage. Progress is stored on the current browser and is not synchronized between devices or users.
