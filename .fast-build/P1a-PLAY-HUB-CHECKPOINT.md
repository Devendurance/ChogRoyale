# P1a Play hub and battle routing checkpoint

- Baseline: `5d4dd51` B4.1 Friends complete.
- Scope: player-facing `/app/play` mode hub and `/app/play/battle` route.
- Unranked and private room actions reuse the existing Colyseus queue, room-code flow, `LoadoutPicker`, `BattleHud`, `BattleCanvas`, reconnect logic and result state.
- `/dev/battle` remains a separate development entry using the same shared `BattlePanel` session.
- Ranked is shown as unavailable because this repository has no ranked queue, rating or trophy persistence API.
- Public battle mode hides the Dev diagnostics panel and keeps room codes in the player-facing lobby state.
- Public CTA links now target `/app/play`.
- Verification: focused Vitest tests passed, typecheck passed, production build passed. Lint passed with the existing `src/app/dev/progress/page.tsx` `<img>` warning.
- Browser fixtures: signed-out `/app/play` and `/app/play/battle?mode=private` loaded at the local server with no fresh console errors. Live Privy and authenticated multiplayer QA were not attempted.
- No backend, combat, database or settlement changes.
