# Guess The Friend

Original local game plus a Google Apps Script / Google Sheets synchronized online multiplayer mode.

## Project contents
- `index.html`, `style.css`, `script.js`: existing local game and preserved assets/design.
- `config.js`: the only frontend setting; paste the deployed Apps Script Web App URL.
- `multiplayer.js`: online lobby, synchronized answering, per-answer voting, scoring, reconnect polling, and final leaderboard client.
- `apps-script/Code.gs`: Apps Script API and spreadsheet initialization.

## Deploy the database and API
1. Create a new Google spreadsheet for this game. Use a dedicated spreadsheet; the initializer creates the `Lobbies`, `Players`, `GameState`, `Answers`, `Votes`, and `Questions` tabs.
2. Open **Extensions → Apps Script** from that spreadsheet.
3. Replace the editor contents with `apps-script/Code.gs` (or paste it into `Code.gs`).
4. Select and run `initializeDatabase`. Approve the requested spreadsheet permissions. It stores the spreadsheet ID in Script Properties; no ID or credential is placed in frontend code.
5. In Apps Script, choose **Deploy → New deployment → Web app**.
6. Set **Execute as: Me**. Set access to **Anyone** (or the broadest audience allowed by your Google Workspace policy). This is required for guests to call the public game endpoint. The API still validates each player using an unguessable session token.
7. Deploy and copy the Web App URL ending in `/exec`.
8. Paste that URL into `config.js` as `API_URL`.
9. Host the project folder on any static web host (or a local static server for development). The Apps Script backend must be deployed separately; a static host cannot execute `.gs` files.

## Maintenance
Run `cleanupExpiredLobbies` manually or add a time-driven Apps Script trigger (for example every 10 minutes). Inactive lobbies are marked expired after 30 minutes. The cleanup routine does not delete spreadsheet rows or unrelated spreadsheet data.

## API actions
`createLobby`, `joinLobby`, `getLobbyState`, `selectCharacter`, `setReady`, `startGame`, `submitAnswer`, `submitVote`, `advancePhase`, `leaveLobby`, `heartbeat`, `playAgain`, and `closeLobby`.

Mutations use `LockService`, session-token hashes, request IDs when supplied, server-side validation, six-character collision-checked codes, eight-player capacity, exclusive character selection, and monotonically increasing lobby revisions.

## Gameplay and deployment notes
The online mode now supports synchronized lobby start, one answer submission per player, an individual guessing/voting sequence for every submitted answer, server-side scoring, multiple rounds, a final leaderboard, host continuation after a voting deadline, and a host-only Play Again action. The existing local game mode and visual theme remain in place.

The Apps Script backend must be deployed in the user's Google account and its `/exec` URL must be configured in `config.js`. After updating `apps-script/Code.gs`, deploy a **new Web App version** so the live endpoint runs the updated code. The target spreadsheet must be initialized once with `initializeDatabase()`. Live cross-device behavior cannot be verified from this packaging environment; test with at least three separate browser sessions/devices before sharing the game. The API uses HTTP polling (not WebSockets). Apps Script quotas, execution time, and concurrent spreadsheet traffic should be load-tested before a large public launch.

## Change log
- Added dedicated online lobby modal and create/join/waiting-room UI.
- Added configurable Apps Script endpoint.
- Added spreadsheet schema initialization and server-side lobby/session/character reservation operations.
- Added revision-based polling and a 30-second reconnection window.
- Connected the online game screens to the authoritative backend for answering, per-answer voting, scoring, rounds, and results.
- Reduced routine synchronization to one heartbeat/state request per polling cycle.
- Preserved local game mode, assets, sound files, and visual theme.


## Voting integrity and synchronization hardening
- The server rejects votes from the answer author, self-target votes, non-roster targets, duplicate votes, votes for a non-active answer, and votes submitted after the server deadline.
- Eligible voters are counted against the current lobby roster; a disconnected player remains eligible during the 30-second reconnect window.
- Each answer receives a fresh server-side `phaseStartedAt` and `deadlineAt`. Heartbeats and page refreshes do not restart an active timer.
- Clients use the server timestamp to reduce countdown differences caused by device clock drift.
- The vote screen omits the current player's own name and shows an explicit waiting message to the answer author.
- Polling is centralized, non-overlapping, reduced while the tab is hidden, and uses exponential backoff after failures.

## Host settings and per-player voting display
- Before creating an online lobby, the host can set the round count and duration in **Game Settings**. Those exact values are sent when the lobby is created and stored in the authoritative lobby state. A one-round setting remains `1`; the game finishes after that round instead of silently falling back to five.
- The voting deadline remains server-authoritative and is reset for each answer. A player sees the countdown only while eligible to vote and before submitting their vote. Answer authors and players who have already voted do not see a running countdown; they see a waiting message instead.

### Question randomization and voting countdown
The online server shuffles the built-in question deck at the start of each game (and Play Again). It assigns one new question per configured round and stores the chosen deck/index in the lobby state, so all players see the same question after polling or reconnecting. Voting countdown UI is shown only to an eligible player who has not submitted a vote. Once a player votes—or if they authored the active answer—the UI displays “Waiting for other players to vote.”


## Sequential voting implementation notes
For each answer, the server snapshots the eligible voter list (everyone except the answer author) and activates exactly one `currentVoterId` at a time. The queue is not rebuilt from connection status. The active turn owns the server `deadlineAt`; waiting players have no active countdown. A vote is accepted only when the authenticated player matches `currentVoterId`, the answer ID matches the active answer, the target is a valid roster player, and the server deadline has not passed. A late request causes the server to advance the expired turn under the same lock and then rejects that request. The frontend does not disable valid vote targets merely because their presence indicator is stale.
