# Guess The Friend — repair and verification report

## Fixes implemented
- Server-side self-vote rejection (`SELF_VOTE`).
- Server-side answer-author voting exclusion (`ANSWER_AUTHOR_CANNOT_VOTE`).
- Server-side checks for active answer, lobby target, duplicate vote, voting phase, and deadline.
- LockService remains around all mutating actions to serialize simultaneous votes and phase changes.
- Voting options exclude the current player; answer authors receive a waiting state.
- Each answer receives a fresh server-authoritative voting deadline.
- Heartbeats do not reset the timer; expired votes are finalized by the server.
- Server timestamp is included in public state to reduce device-clock countdown drift.
- Corrected reconnect expiry to use the actual 30-second period since the last heartbeat.
- Host migration now selects the most recently active connected player.
- Leaderboard displays character avatars, shared ranks for ties, and winner indication.
- Polling defaults to 2 seconds, avoids overlapping requests, backs off exponentially after failures, and slows while the tab is hidden.
- Responsive voting and leaderboard layouts hardened for narrow portrait and short landscape screens, with safe-area padding.

## Automated checks performed
- `node --check` passed for `multiplayer.js`, `script.js`, `config.js`, and the Apps Script source (checked as JavaScript).
- Backend logic harness passed:
  - valid vote accepted
  - self-target rejected
  - answer author rejected
  - non-active answer rejected
  - duplicate vote rejected
  - nonexistent target rejected
  - expired vote rejected
  - all eligible votes transition to results
  - next answer receives a fresh full-duration deadline
  - heartbeat/page refresh preserves the active deadline
  - heartbeat finalizes expired voting
- HTML parsed successfully with Python's standard-library HTML parser.
- No duplicate HTML IDs found.
- CSS opening/closing brace counts match.
- All statically referenced local HTML assets exist; the character sprite path is intentionally generated from the selected character.
- ZIP integrity verified after packaging.

## Not verified in this environment
- Live Google Apps Script deployment and Google Sheets persistence.
- Three-or-more-device multiplayer behavior over the public deployed endpoint.
- Actual visual rendering at every requested viewport size. No browser automation runtime was available in this environment.
- Network latency, Apps Script quota behavior, and load testing.

## Deployment note
After replacing the Apps Script source, deploy a **new Web App version**. Keep the existing spreadsheet and configured `SPREADSHEET_ID` Script Property. Test with at least three separate player sessions before public use.

## Follow-up update — host round settings and voting countdown display
- Online lobby creation now sends the host's selected duration and round count from the existing Game Settings controls.
- Apps Script normalizes settings while preserving an explicit `rounds: 1`; the existing server round progression finishes when the configured round count is reached.
- The countdown is rendered only for a player who is currently eligible to vote and has not voted on the active answer.
- The answer author sees: “You submitted this answer. Wait for the other players to vote.”
- A player who has voted sees: “Your vote has been submitted. Waiting for other players to vote.” The client stops that player's countdown immediately.
- Verified with Node syntax checks for both frontend scripts and Apps Script source (Apps Script source copied to a `.js` file for parsing), static requirement assertions, and an isolated settings-normalization test covering 1 round, 10 rounds, and defaults.
- Live deployment and multi-device behavior remain unverified until the updated Apps Script is deployed and tested with separate player sessions.

## Latest multiplayer fixes
- Added a server-side shuffled question deck. Every new game and Play Again session starts with a freshly shuffled order; each configured round receives the next unused question, so questions do not repeat until the 20-question deck is exhausted.
- The selected question is stored in the authoritative lobby state, so every player sees the same question and refresh/reconnect does not reshuffle it.
- Exposed per-player voting eligibility from the server. The client only displays/starts its voting countdown while the player is eligible and has not voted.
- After a player votes, or while viewing an answer they authored, the voting controls/countdown are hidden and the status reads “Waiting for other players to vote.”
- Static validation: `node --check` passed for `multiplayer.js` and the Apps Script source (checked as a temporary `.js` file). ZIP integrity check passed after packaging. Live multi-device testing still requires deploying the Apps Script and testing with connected devices.


## Final source-level verification after the sequential-voting hardening
- Confirmed the online client no longer disables vote-target buttons from `p.connected`; only the active submission lock can disable them.
- Confirmed the backend builds `voterOrder` from the answer's roster rather than live connectivity.
- Confirmed the backend keeps `currentVoterId` authoritative and rejects non-active voters.
- Confirmed deadline handling advances the timed-out turn while holding `LockService`, then rejects the late vote.
- Confirmed the client schedules an immediate poll after a failed vote request.
- Confirmed `Code.gs` and `Code.gs.js` remain byte-for-byte equivalent after the repair.

## Verification boundary
These checks are source/static and local harness checks. They do **not** prove the live Google Apps Script deployment or real three-browser network behavior. A live three-session test remains required after deploying the updated `Code.gs`.
