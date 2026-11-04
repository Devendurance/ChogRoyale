# V1 stabilization: fair start, rematch lifecycle and performance

Date: 2026-11-04. Branch `fix/v1-match-reliability`. No merge or deployment.

## Root causes

1. **Battlefield readiness.** The server began simulating the moment both loadouts
   locked. The result screen and hand could render long before the arena textures
   and Phaser scene had painted, so an AI or a faster opponent could destroy
   towers while a player was still loading.
2. **Unranked rematch.** The result view model carried a "Find Opponent Again"
   label for human matchmaking, but `BattleResult` only rendered the action for
   the AI fallback. When the action did run, the finished room's delayed close
   could overwrite the new queue session.
3. **Practice rematch.** The finished room's close callback ran after the next
   room had been created, so the panel dropped into `closed` instead of the new
   lobby. Room close timing also depended on room-clock timers.
4. **Repeated sessions.** `Phaser.Game.destroy` deletes its GL objects but leaves
   the WebGL context to the GC. Eight rematches held eight live contexts.

## Fixes

- `MatchArming` freezes both modes at tick 0 until every human seat sends
  `client_ready` after a painted battlefield. The 60 s deadline aborts with no
  result. Tick 1 is the only go signal. A drop clears only that seat, and a
  resumed seat must report again. Commands are refused while frozen.
- `battle-connection.ts` gives the panel one owned room. A replaced or released
  room can no longer deliver a late close or late frame into the next session.
  Rematch resets disown the finished room before leaving it.
- Unranked human and AI-fallback results both expose "Find Opponent Again";
  practice exposes "Battle Again". Both build a fresh session.
- Room close timers are plain timers cleared on dispose, independent of the
  simulation interval.
- `battleAssetPlan` can exclude DOM-only card portraits from the Phaser texture
  plan. The lobby prewarm still fetches them for the HUD.
- Destroying the renderer now loses the WebGL context explicitly.
- `battle-preload.ts` prewarms the renderer chunk and every battle asset before
  the match, from the same manifest load the scene uses.

## Verification

Focused tests: 75 passed across arming, room ownership, asset plan, result view
model and the real-socket match-start/rematch suites. TypeScript and scoped
ESLint pass.

Browser acceptance on the production build (headless Chromium, injected auth,
real battle server) in `ChogRoyale-Assets/final-assets/live/v1/results`:

- Slow start (5 Mbit/s, 60 ms latency, 4x CPU throttle): battle visible at
  52.2 s, tick 0, 0 troops, 0 crowns, 4400 structure HP. The pre-fix baseline
  lost 32.1 s, conceded a crown and had 3710 HP at first paint.
- Two-browser PvP with a delayed opponent paint: both seats were at tick 0 at
  their own paint and at the other seat's paint. Seats `[1, 0]`, both ended and
  both re-entered a fresh queue.
- Rematches: 5 consecutive practice matches and 5 consecutive unranked fallback
  matches, with no `closed` stage or socket errors.
- Lifecycle: delayed paint, refresh while held, refresh mid-match, 8 s stall
  abort with Battle Again, renderer chunk failure and leave all pass.

Performance on Intel Iris Xe, 45 s of live practice per viewport, production
build. Baseline and after use the same server tick and viewport set:

| View | Baseline avg FPS | After avg FPS | Baseline p95 | After p95 | Texture memory |
| --- | --- | --- | --- | --- | --- |
| Phone 390x844 @2x | 55.0 | 56.2 | 16.8 ms | 16.8 ms | 123.5 → 116.9 MB |
| Tablet 768x1024 @2x | 56.9 | 56.7 | 16.8 ms | 16.8 ms | 123.5 → 116.9 MB |
| Desktop 1920x1080 | 52.5 | 53.3 | 16.8 ms | 16.8 ms | 123.5 → 116.9 MB |

Repeated sessions: 8 matches kept one open WebGL context, released 7 on
rematch, and held JS heap at 9.2 to 12.5 MB with 719 to 735 DOM nodes and 458 to
509 listeners. No page or console errors.

## Limits

- Headless Chromium on integrated graphics, not physical phones or tablets.
- No dense bucket (>9 simultaneous troops) was reached in either run.
- No real Privy sign-in, NFT commander match or deployment was performed.
- Frame timing varies with workstation load. The memory result is the reliable
  code-level delta; FPS is reported as non-regression, not an improvement claim.
