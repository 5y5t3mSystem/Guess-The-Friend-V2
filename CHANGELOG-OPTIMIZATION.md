# GuessFriend audit and repair notes

## Implemented
- Local voting now excludes the answer author from the voter rotation, preventing authors from voting on their own answer.
- The local voting countdown advances only while the voting screen is active and the browser tab is visible. It pauses when the player switches screens or backgrounds the tab, then resumes with the remaining time.
- The online voting countdown is displayed only while the online modal is open, the tab is visible, and the server confirms that this player is eligible and has not voted. Closing/backgrounding the online game stops the display interval; reopening refreshes the server-authoritative deadline.
- Removed a redundant question-deck shuffle operation and made the preset question bank reshuffle only after all preset questions have been used.
- Added a final responsive CSS layer for 320px+ phones, tablets, laptops, desktops, ultrawide screens, short landscape viewports, safe areas, readable text wrapping, and accessible keyboard focus.

## Important behavior distinction
- The local/pass-and-play timer is paused while the voting screen is not actively visible.
- Online multiplayer deadlines remain server-authoritative and continue to elapse for fairness even if one player closes the modal or backgrounds their device. Only that player's local countdown display pauses. The server still rejects late votes and finalizes expired voting.

## Audit recommendations / remaining considerations
- The Apps Script backend uses a global script lock and a full Lobbies sheet scan per lobby lookup. This is safe for serialization at small scale but can become a throughput bottleneck as lobby history grows. Consider archiving/deleting expired rows and using a dedicated indexed lookup strategy if usage grows.
- Google Sheets is not a high-throughput realtime database. For larger concurrent audiences, migrate authoritative lobby state to Firebase Realtime Database / Firestore or another transactional realtime backend.
- `getState_()` currently changes a player's in-memory connection fields but does not persist them. The client uses heartbeat instead, so either persist this endpoint's heartbeat semantics or remove/deprecate the unused endpoint to avoid inconsistent behavior if another client calls it.
- The backend's normalized Players/Answers/Votes/GameState sheets are initialized as inspectability tabs, while the authoritative snapshot is Lobbies.stateJson. Keep this distinction clear; do not treat the derived tabs as the source of truth unless synchronization is implemented.
- The current voting timeout intentionally allows the server deadline to expire even if a player is offline. This avoids one disconnected player freezing the game, while still permitting reconnects during the configured grace period.
- Live Apps Script deployment, real Google Sheets persistence, multi-device network conditions, and actual physical-device rendering cannot be proven by static checks. Test with at least three independent devices/sessions after deploying the updated Apps Script version.

## Sequential online voting correction
- Online voting is now assigned to one eligible player at a time by the server.
- Only the active voter receives a live countdown; waiting players see a waiting message and their timer does not start.
- The answer author sees: “That's your answer, don't get caught!” and cannot vote on their own answer.
- A successful vote advances the turn and starts a fresh full timer for the next eligible voter.
- When a voter's timer expires, that turn is skipped and the next eligible player receives their own timer; after the final eligible turn, the answer is revealed.
- Server-side validation rejects votes submitted out of turn, preventing clients from bypassing the sequence.


## Final sequential-voting hardening
- Fixed a frontend eligibility bug where vote-target buttons were disabled whenever the target player's live `connected` flag was false. Voting targets are now controlled by authoritative voting state; transient connection status no longer makes valid target buttons unclickable.
- Fixed the voter queue so eligibility is snapshotted from the answer's player roster and is not recalculated from live connection state. A temporary heartbeat failure therefore cannot silently remove a voter from the established sequence.
- Voting turns now follow the established player order for the answer, so with A/B/C and A as author, B is the first active voter and C follows B.
- Added server-side expiry advancement when a late vote arrives exactly at/after the deadline. The expired turn is advanced under the same script lock before the late request is rejected.
- Failed vote requests now trigger an immediate state poll so clients recover from deadline/turn changes without waiting for the next normal polling interval.
