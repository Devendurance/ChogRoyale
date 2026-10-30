# CRITICAL RULES - MUST FOLLOW

- The final audio overhaul uses one persistent app-level mixer and preserves the existing authoritative battle cue engine/deduplication. Shared audio ownership must survive app navigation and battle resets without closing the app context. Explicit mute and zero-volume choices survive preference migration and reconnects.
- Supplied Spooky Halloween is the CC0 lobby track, credited as "Misterbates - Spooky Halloween". The owner supplied the processed Village Game Theme Loop and asserts purchased usage rights for production integration. Preserve the original Mrthenoronha, Freesound 520710 attribution and `CC BY-NC 4.0` metadata. Do not call it CC0 or invent proof of purchase. The owner assertion and the absence of purchase documentation in this repository must remain clear in the manifest and credits.
- Audio generation reads ELEVENLABS_API_KEY only in local production scripts. Verify configured commercial rights before generation, package files once and never call the generation API from browser interactions. Success/reward cues require confirmed server outcomes.

- Final polish uses player-relative identity: self left/blue in the HUD and top/blue in results, opponent right/red and bottom/red, regardless of seat or winner. Crown flights target the corresponding score ref. Use the official alpha crown at its natural 256:236 ratio, including victory, defeat and flights. Keep trophies separate.
- Private invites contain only the current-origin `/app/play/battle?mode=private&room=` URL and a validated case-sensitive Colyseus nanoid(9). Preserve that destination through login/setup. Attempt automatic joining once after setup is verified, never auto-ready. A locked-room refusal can mean full or already started.
- An active invite URL must recover its matching saved seat on refresh. Prioritize saved resume credentials only when their room matches the invite, never resume a different room or add recovery credentials to the URL. Mark automatic attempt refs inside the scheduled task so Strict Mode cleanup cannot consume an attempt.
- Queue handoffs must mark ownership before awaiting reservation consumption, attach the reserved battle room before awaiting queue cleanup, and ignore late queue-close callbacks. Battle rooms may replay an authenticated lobby snapshot through `lobby_sync`; never render a lobby stage with no visible loading or recovery action.
- Owner authorization on 2026-10-27 covered merging approved PR #6 and pushing/opening the final polish PR. PR #7 was subsequently merged by the owner. New merges and production promotions still need separate owner approval. Current session subagents use GPT-5.6 Luna with extra-high reasoning and coordinator review, per the owner's latest preference.


- Auto-log meaningful rules to the project’s AGENTS.md.
- Gameplay video bookmarks use genuine thumbnails from the linked recording and open its actual player. Use the Drive `/preview` destination for Drive recordings.
- Auto-commit and push after every meaningful checkpoint.
- Auto-clean temporary files and build clutter.
- Keep the repository in a recoverable state.


## WRITING


- Never use em dashes. Use commas, periods, hyphens, or rewrite the sentence.
- Do not use the “It’s not X, it’s Y” correction pattern. State the correct point directly.
- Avoid choppy writing. Keep the flow natural.
- Avoid semicolons in casual replies. Use periods or normal conjunctions.
- Remove stock transitions like “however,” “furthermore,” “it’s worth noting,” and “in conclusion.”
- Use contractions in casual contexts. Say “don’t” instead of “do not.”
- Use simple words. Say “use” instead of “utilize,” “start” instead of “commence,” and “find out” instead of “ascertain.”
- Avoid mid-sentence ellipses unless you’re writing deliberate dialogue.
- Avoid parenthetical asides when the idea can fit naturally into the sentence.
- Use colons sparingly. Don’t label every paragraph or list.
- Remove chatbot filler like “Great question,” “I hope this helps,” “Let me know if,” “Here is a,” and “Let’s dive in.”
- Do not use emojis unless the user clearly wants that style. (This is specific to me, you can leave it if you like to use emojis tho)
- Do not use bold text for emphasis in normal prose.
- Challenge weak reasoning. Flag unsupported claims. Do not agree just to be polite.


## RESPONSES


- Keep responses concise and to the point unless the user asks otherwise.


## AGENT STATE


- Long-running project state lives in `agent-state/`:
  - `project-state.md` tracks what's been built, the architecture, and important decisions.
  - `memory.md` tracks durable facts, conventions, and gotchas.
  - `left-off.md` tracks the current task, what's done, what's next, and known issues.
- At the start of every session, read all three files before doing anything else.
- Update them at every meaningful checkpoint: feature finished, decision made, bug found, direction changed.
- Keep them short. Bullets, not essays. `left-off.md` must always answer: what are we doing, what's done, what's next.
- Never store secrets or credential values in state files.
- When the session gets compacted or messy, a new session resumes from these files.


## CONTEXT MANAGEMENT


- When the active agent session approaches roughly 250,000 consumed context tokens, proactively compact or summarize the working context before continuing. Do this before context degradation becomes noticeable.
- Preserve the current objective, repository truth, completed checkpoints and commit hashes, architectural and product decisions, unresolved blockers, relevant environment variable names but never secret values, important implementation invariants, tests and verification state, and the exact next action.
- Do not over-compress implementation-critical details.
- After compaction, continue from the preserved state rather than re-auditing the entire repository.


## PLANNING MODE


- Always ask clarifying questions.
- Never assume the design, tech stack, or features.
- Use deep-dive sub-agents to assist with research.
- For research work or research assist sub-agents, use SWE-2 model with a high reasoning/thinking effort if not available use muse spark-1.3 contributor with x-high reasoning effort.
- Use deep-dive sub-agents to review the different aspects of your plan before presenting it to the user.


## CHANGE / EDIT MODE


- Never implement features yourself when possible; use sub-agents.
- Identify changes from the plan that can be implemented in parallel, and use sub-agents to implement the features efficiently.
- When using sub-agents to implement features, act as a coordinator only.
- After completing features, whether large or small, always run commands such as lint, type check, and next build to check code quality.


## DATABASE SCHEMA CHANGES


- Whenever you make changes to the database schema, ALWAYS run `db:generate` then `db:migrate`.
- NEVER run drizzle push.


## TESTING


- Use any testing tools and libraries available to the project to test your changes.
- Never assume your changes work; always test.
- DB-writing tests must call `routeDalToTestDb()` in `beforeAll` (isolated Neon TEST branch). `getDb()` throws under Vitest without it. Clean owned fixtures in both `beforeAll` and `afterAll`.
- If the project does not have any testing tools, scripts, MCP tools, or similar resources available for testing, ask the user whether testing should be skipped.


## UI DESIGN


- Always follow or reference the UI design system when creating or reviewing components or pages.
- Design System: @DESIGN.md

## LOCAL ASSET PRODUCTION

- Keep Blender experiments and test outputs outside this repository in `C:/Users/USER/Documents/ChogRoyale-Assets`.
- Reuse the existing local Blender MCP connection, keep its bridge bound to loopback, and preserve live Blender work when verifying or producing assets.
- Reference packs must follow stored token and image URIs. On-chain token IDs can differ from NFT display numbers and artwork filenames.
- Preserve original NFT metadata and artwork separately from authored reference views. Use existing trait-derived commander classes, and keep original troop designs separate from NFT identities.
- Derive troop art direction from the actual r001 portrait pixels, not written briefs. Original troops must keep the Chog face mask, backswept rear spike fan, Round eyes, blush and heavy outline. Don't give troops ears or a nose, because no authentic portrait shows them.
- Before writing into a shared asset review folder, list it for files from other sessions and write into a separate subfolder instead of overwriting their README or approvals.
- For mesh audits, distinguish UV/normal split vertices and fitted-detail borders from true holes. Report BVH overlap candidates separately from validated triangle crossings. Don't blindly remesh or cap detail bases, since that can erase intentional geometry or disguise fit issues.
- Basic rig setup must be idempotent and leave exactly one armature modifier. Validate automatic weights by measured nonzero weighted-vertex coverage, not by checking whether vertex groups exist. Static foot-height correction does not validate IK or continuous animation.
- Crossing exceptions need pair identity or component evidence plus camera visibility across sampled motion. A height threshold alone doesn't prove an intentional overlap. Save collapsed triangle face IDs and coordinates with deformation metrics so blockers can be located later.
- Edited Blender image copies can retain stale packed bytes. Load edited PNGs as new images before packing, then save and reopen the blend to verify active edited-image hashes and unchanged source pixels.
- Rigid modular parts remove skinning collapse but still need visible joint, cap, gap and clipping checks across timed motion. Use one fixed camera and shared crop/scale for complete loops, and measure foot contact and sliding across stance intervals. Rigid triangle-area preservation alone cannot establish animation readiness.
- For 2D cutouts, assert transparent background alpha after extracting every part. Preserve approved head RGB, and judge small-size attack intent from the whole gesture rather than finger detail. Use one neutral-character-derived scale across all keys, distinguish character height from canvas height, and report keyed stance checks separately from continuous motion or runtime validation.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## BATTLE SERVER

- Battle identity comes only from a server-verified Privy token in the matchmaking Authorization header. Never put tokens in URLs, room options, logs or replicated state. Seats, seeds, decks and Chaos are server-chosen; clients send intents only.
- The dev battle alpha writes nothing to the database. Settlement, legacy and leaderboard updates belong to later B3 slices.
- Unranked AI Gold is displayed only from a validated `bot_gold` message whose fallback provenance and `matchId` match the ended room. Never infer Gold from the result, duration or `practice.noReward`, and refresh the authenticated balance only after a confirmed server message. Keep the V2.1g reward flag and production migrations owner-gated.
- Bot Card XP reuses server-verified `bot_matches` evidence and the shared Gold-confirmed eligibility gate, then writes only the separate idempotent bot XP ledger into the existing card progression ladder. Keep `UNRANKED_BOT_CARD_XP_ENABLED` default-off, require the Gold flag, exclude pre-flag evidence and Solo Practice, and never backfill historical bot XP.
- Practice UI uses the server-owned `battle_practice` room and `practice` mode, keeps the bot identity as `AI Opponent`, and must not resume or settle a PvP room as Practice.
- Practice difficulty selection is a client request only. Send it to `battle_practice`, then display and retain the server-confirmed opponent difficulty through reconnects, results, and fresh Battle Again rooms.
- Unranked AI fallback keeps the public route intent as Unranked while the server room reports `practice`; use `practiceOpponent.source === "unranked-fallback"` and a separate resume slot to preserve that origin through reconnects and results.
- Matchmaking fallback UI is opt-in to the server's advertised `queue_status.fallback`; never invent a countdown or bot assignment when that field is absent, and keep `UNRANKED_AI_FALLBACK_ENABLED` unchanged until owner activation.

## BATTLEFIELD PRESENTATION

- B2.8g.1 environment polish stays outside the authoritative board. Non-interactive CSS atmosphere may frame the canvas, and Phaser mount shadows may ground existing structures, but the 100x160 transform, pointer mapper, deployment bounds and V002 layer geometry remain unchanged.
- Visual Core padding may lower only the authored mount assembly and its presentation labels. Keep the authoritative ground point, health model and weapon anchors fixed. Team accents must derive from `owner === seat` for both perspectives, with decorative pennants and halos kept inside the noninteractive canvas presentation.
- Combat VFX must key off authoritative event identity or observed authoritative HP change. Keep a bounded dedupe set, destroy temporary Phaser objects after their cue window, and never turn an advisory placement preview into a success effect.
- Fixture screenshots are presentation evidence only. Pointer/deployment delivery and touch behavior remain pending a real two-player regression.
- Final assets live in the same `chog-units/v001` manifest: buildings by card id (`kind: "building"`, `deploy` clip), commanders as `commander_<class>` (`ability` clip, class art shared by every commander, never an NFT likeness), `burrow_scrapper` (`kind: "spawned"`). Pack new units with `MERGE=1 UNITS=...` so approved troop sheets are never repacked.
- Building and commander clips fire only from authoritative events (`building_spawned`, `siege_fired`, `unit_spawned`, active `ability_fired`) or presentation engagement mirroring the ruleset range test. The Rift Sentry has no public fire event, so its swing is engagement-driven.
- Spell and ability area boundaries must be drawn at the exact ruleset radius as screen circles (the board maps both axes linearly). Status markers mirror the rule an event applied and vanish when it ends or the unit dies. Allegiance tints (friendly blue, enemy red) only for allegiance cues; elemental VFX keep their colours on both seats.
- Battle VFX live in `public/assets/battle-vfx/v001` (built by `tools/vfx/build_vfx.cjs` plus `build_vfx_props.py`), planned by pure `battle-vfx.ts` and drawn by `vfx-layer.ts` with a 180-sprite cap. If the VFX manifest fails, the older Graphics cues must still run.
- Pre-rendered 2.5D arena layers (v003+) are camera-space (`space: "camera"`) and must never be flipped for seat 1, or trees, posts and banners turn upside down. Only board-space overlays mirror. New layers keep logical points on exact master pixels via the pitched ortho camera with ground Y stretched by 1/cos(pitch). Check the projected anchors before importing.
- Tower mounts are player-relative roles from `structureMounts`: the opponent gets red Bulwark mounts aiming south and the viewer gets blue Chog Guardian mounts aiming north. Weapon anchors come from projected 3D muzzle points, never hand-picked pixels. Keep v002 as the runtime fallback.
- Defender art refinements are judged against the original card first. Reject a revision that is prettier but less recognizable as its Chog. Visual-only refinements must leave weapon anchors, pivots, ground anchors and the ripple and Chaos layers unchanged, so compare the export log anchors before importing.

## GAME APP SHELL

- Plain app CSS needs runtime `--font-site`, `--font-data` and `--font-game` aliases inside `.app-root`. Tailwind inline theme entries only substitute utilities, so relying on them for CSS `font` shorthands silently drops both font family and size.
- The Privy provider lives in the shared `/app` layout. A route inside `/app` must never mount its own provider, or a route change tears the session down and starts a second one.
- Card names, costs, type labels, traits, descriptions and stat rows come from `src/lib/card-details.ts` and the ruleset tables. Never write card copy by hand and never read a card cost from anywhere else.
- The deck screen may only write through `GET`/`PUT /api/players/me/loadout`. Keep the revision check and the 409 behaviour. Do not add a second persistence system or a new endpoint.
- "Saved to your account" may only appear after the server confirms the save. Loading, unsaved, no saved deck, service unavailable, revision conflict and save failed are separate states, and an unsaved deck must stay on the device instead of being discarded.
- A saved NFT token id is a claim, not proof of ownership. The battle server re-checks ownership at ready and at match start. Commander class art is shared by every commander of that class and must be labelled as class art.
- Ranked public matchmaking stays closed behind `RANKED_PUBLIC_MATCHMAKING_ENABLED` until the approved production migrations, settlement runtime and public deployment are live. Ranked read endpoints may render server-owned values, but clients never calculate trophy deltas or use URL parameters to bypass the gate.
- Card progression is account state, not ruleset copy. The decks screen may show only server-returned purchased level, XP, Gold and upgrade eligibility. It must never calculate combat stat previews, advance a level optimistically, or treat a schema-unavailable response as zero progress.
- Private messaging is server-authoritative social state. `/app/messages` may open conversations only through `POST /api/players/me/messages/conversations`, keeps 403 peer failures neutral, preserves the same UUID for an uncertain send retry, acknowledges only received messages actually viewed, and never turns service/schema failures into an empty inbox.

## PROGRESS

- `/app/progress` is the authenticated progression surface. `/dev/progress` stays the development surface and is not redirected or deleted.
- A successful 200 with zero rows is empty. A 401 is a session failure, a 403 is a setup lock, and a 500, 503 or network failure is unavailable. Never turn a failed stats, history or leaderboard read into "no matches" or zeroes.
- Progress reads only the existing `/api/players/me/stats`, `/api/players/me/matches` and `/api/leaderboard/casual` endpoints. Do not add progression, rating, reward, trophy, XP, level or streak mechanics.
- Match history is cursor-paginated and caller-side only. Never render seeds, commands, state hashes, wallets, Privy identifiers, player ids or the opponent's deck.
- The Casual Alpha Leaderboard is unranked matchmaking only. The minimum and eligibility come from the server. Private rooms never count, and the screen must not imply a ranked ladder.
- The profile "Open progress" action and the Progress nav tab both point to `/app/progress`.
- At 520px and below, the disabled Commanders nav label takes a smaller step with no side padding so it cannot spill into the active tab.

## GENESIS LEGACY

- `/app/progress/legacy` is the token-centric Genesis legacy vault. `/dev/progress` stays the development surface. The five-tab nav does not gain a sixth tab; the Progress tab stays active on the legacy route.
- Legacy belongs to the Genesis token, not the wallet. Current holdings are cached verified-wallet observations. A commander appearance carries its own match-start direct-owner proof. An Arena Patron appearance is server-selected and is never presented as a player commander choice.
- The vault reads only `/api/players/me/nfts`, `/api/players/me/commanders`, `/api/nfts/[tokenId]/legacy` and `/api/nfts/[tokenId]/achievements`. Do not add endpoints, tables, backfills or sample records.
- Only a successful legacy payload with total 0 is empty. A 404 is not indexed, 401/403 is session or account state, and 500/503/network is unavailable. Never turn a failed read into "no legacy".
- Achievements are earned-only in the read route. Locked progress may use the authored definitions plus the token's verified counts. Never invent tiers, points, rarity, rewards or award dates. A missing award date still shows as earned.
- Never expose authority keys, match ids, hashes, config or schedule hashes, source/actor, wallets or Privy identifiers. Class art is shared and must be labelled. Genuine token art only when the route resolves an authorized image URL.

## PUBLIC SITE

- Build the public landing page one handoff phase at a time (L0 to L8) and stop for owner screenshot approval after each phase.
- Final site copy comes from `docs/Chog Royale messaging.md`. Every claim must match shipped code. Don't present ranked, rewards, economy or social features as live.
- Keep site styles scoped to `.site-root` or `site-` classes. Cache Components keeps hidden routes mounted, so html-level site rules must be applied from an effect, never via `html:has(...)`.
- Reference media A-F is study-only and never ships. The G hero image and any NFT art need owner rights confirmation before public release.
- Commander class art is shared by every commander of the class. Label it as class art on the site and never present it as a specific NFT. Keep NFT commanders (player-selected) and the Arena Patron (server-selected) distinct in copy.
- Site sections that crop art against their own edges must measure the source PNG's painted alpha bounds before positioning, and must verify text and art separation with per-line Range rects, not element boxes. A hover lift uses the `translate` property, because a scroll entrance animation on `transform` overrides it.
- A section that pulls up into the previous one with a negative margin needs a real top padding and a background whose top is transparent, or the next heading lands on the seam and reads as part of the section above.
- A landing intro that must play on every genuine visit must store nothing. Watch `usePathname()` and start on the first mount and on any return to the route, and never on a re-render, a scroll or an in-page anchor.
- An overlay that is server rendered paints before React hydrates, so "the element exists" is not "the script is ready". Drive the teardown from the CSS `animationend` event rather than a timer, and wait for a focus change before scripting a click in a test.
- A server rendered control must not be painted before its handler can run. Use a hydration-safe store (`useSyncExternalStore` with a false server snapshot) rather than a `setState` in an effect, which trips the react-hooks lint rule.
- `aria-modal="true"` is a promise that the background is inert. If the modal lets pointer events through, it is only half modal and a mouse user can reach a control that assistive tech cannot. Either block the pointer on the overlay or drop `aria-modal`, and make a background click dismiss so nothing feels dead.
- An overlay that dissolves into a page must clear its own foreground before the background thins enough to read the page, or the two foregrounds cross-fade on top of each other and the text is unreadable. Measure the overlay and the foreground opacity at the midpoint of the dissolve, not at a fixed time.
- Removing the focused element leaves the browser's sequential focus starting point where that element was. If focus should return to the top of the document, focus the body with a temporary `tabindex="-1"` instead of jumping to a landmark, or the first Tab skips whatever sits before the removed element.
- A dense row of small controls cannot reach a 44px target without either a wider visible row or overlapping hit areas. Widening the row is the honest fix; overlapping hit areas make one control intercept its neighbour.
- The footer scene is the last element on the page, so it must clip its own absolute layers, and the document must end on the scene rather than on a white band. Place a caption that assistive tech must read outside any `aria-hidden` scene wrapper, and keep every mascot `alt` empty inside it.
- `--color-chog-ink-55` is `rgba(27,17,64,.55)` and measures 3.98:1 on white, so DESIGN.md's 5.6:1 note for it is wrong. Use `--color-chog-ink-70` (6.65:1) for any small text that has to pass WCAG AA, and flag the token when a spec asks for ink-55 as a body colour.
- API envelope shapes differ per route. `GET /api/players/me` nests the profile under `data.player`, while the loadout and commander reads answer with their payload directly. Read the route's own `success()` call before typing the client, or the panel silently reads one level too shallow and throws.
- A client model must degrade a partial payload instead of throwing. Guard array and object reads in the derivation layer, because a blank lobby is far worse than a missing badge.
- A fixed bottom nav means the primary action must be sticky above it. Otherwise the action ends up behind the nav on short phones, and below the fold on a short desktop viewport.
- In the App Router a folder whose name starts with `_` is private and is not routable, so a QA route named `__preview` answers 404.

## SPRITE KIT INVENTORY

- Derive asset scope from current implemented code, including spawned nondeckable units. Count primary entries, card-art derivatives and auxiliary VFX separately, and distinguish commander class templates from exact NFT artwork.
- For approved static sprite handoffs, reserve READY_ANIMATED for verified frame animation. Procedural transform proposals, static contact sheets and export checks do not establish Phaser runtime or real-device readiness. Keep canonical code bindings and measured alpha-bound scale/pivots separate from preserved NFT sources.

- Arena art must map to authoritative engine cell centers and inclusive cell envelopes explicitly. A warning or expiry overlay never opens the Rift Ford. Use authoritative frame.riftOpen for ford presentation and keep environment theme names separate from Chaos mechanics.

- Arena texture derivatives must record source-to-display coordinate and pivot scaling explicitly. A renderer max+1 band fill can differ from authoritative centered-cell art by half a cell. Fix visual adapters without moving engine coordinates, and treat static directional aim poses separately from continuous target tracking.

- Presentation asset readiness and runtime event-binding readiness must be tracked separately. Never infer authoritative tower firing or projectile origins from target-position snapshots. Preserve captured source hashes when a compatible concurrent UI edit is reviewed, and record the observed change as provenance rather than silently replacing history.

## FAST-BUILD ROADMAP

- The dependency-aware plan for all remaining work lives in `.fast-build/ROADMAP.md`. Read it with `.fast-build/STATE.md` and the three `agent-state/` files before starting a Fast-Build slice.
- `.fast-build/STATE.md` is the detailed build log. Never reset, truncate or replace it. The roadmap file does not override recorded history.
- One slice per session. Do not start a second slice or expand scope because another slice looks convenient.
- The active B2.8f.3 live presentation QA is owner-gated. Do not mark it complete from harness evidence.
- Production migrations, deployment, push, real-money flows and social backend authorization remain approval-gated.

## BATTLEFIELD PRESENTATION

- Use GPT-5.6 Luna with extra-high reasoning for delegated project work under the owner's current preference. The coordinator reviews the work.
- Keep contextual card guidance outside layout flow so selection and deselection never resize the arena during a gesture. Card labels wrap at word boundaries, and unaffordable portraits must remain recognizable.
- Audio readiness requires a running Web Audio context, positive volume, an unmuted preference and a visible page. A saved preference alone cannot justify "Sound On". Ordinary melee has no public attack-release event, so use observed authoritative HP loss for its impact feedback.
- Keep battle shell styles scoped to `.chud` and `chud-` classes. Desktop hand placement must not reduce the board's height, and compact landscape rules must stay below the desktop breakpoint.
- Preserve the shared canvas-rectangle pointer mapper and stable Phaser instance. Presentation fixtures prove layout and callback behavior only, never authenticated multiplayer or server acceptance.
- Connection, error and recovery notices must remain visible inside the fixed HUD. Recovery actions reuse the existing session callbacks.
- Desktop board sizing must include the decorative frame overhang (7.5% vertical, 10% horizontal of the canvas) through `--chud-board-w`. Only the CSS display size changes, never the 100x160 mapping.
- Battle HUD, finale and crown styles use the HUD's own `--font-lilita`/`--font-georama` variables. `--font-game` exists only under `.app-root`, so it silently falls back on `/dev/battle`.
- A WAAPI `easing` option applies to the whole iteration and compresses multi-phase choreography. Use linear timing with per-keyframe easing for flights.
- The crown chime sounds when a crown lands on its counter. Under reduced motion it sounds with the confirmed score change. The finale lead-in comes from `end.reason` so a Core's crowns land before the reveal.
- Finale settlement copy has one state per server status. A missing settlement reads as waiting, never recorded. Fixture captures that stub a settled status must be labelled as fixtures.
- Player names resolve only through `battleIdentity()` in `battle-identity.ts`. `LobbyMessage.players` is indexed by join slot (`lobby.you`), while `StartMessage.seat` is the shuffled battle seat, so never read `lobby.players[start.seat]`. Prefer the server's `start.self`, and show only the "You" label when the own name is unknown, never another player's name.
- Identity verification must cover both devices and both seat shuffles with distinct names. A fixture where join slot equals seat cannot catch slot/seat mix-ups.

## NFT COMMANDER LENDING

- P5f.2 lending UI is server-authoritative. `/app/loans` uses only the existing loan routes, accepted-friend records and authenticated commander read. Never render loan party IDs or wallet data, never optimistically grant borrowed access, and keep `{ kind: "nft", chainId, contract, tokenId }` as the saved loadout claim.
- Borrowed commander options require server-returned active loan metadata and remain subject to the existing entitlement check at ready and match start. Lent, expired, revoked and returned options stay unavailable in the selector. Schema or service failures remain explicit unavailable states.

## CARD GIFTING

- P6d gifting uses the existing eligibility, quote and sponsorship routes only. Eligibility is server-owned and requires the accepted-friend age check. Never calculate friendship age, recipient XP, recipient Gold or sponsorship caps in the client.
- Sponsorship quote `nextLevel` is the recipient's current purchased level. Pass it unchanged as `expectedLevel`. Well-formed POST responses use HTTP 200 for domain refusals, and `sponsored` or `duplicate` are the only confirmed outcomes. Success and duplicate responses may omit both `receiptId` and `goldCost`, so the UI refreshes party-scoped history instead of inventing a receipt.
- Keep the same UUID request key for an uncertain retry, never optimistically deduct Gold or advance a card, and never expose sponsorship party IDs, wallets, private XP, balances or raw ledger data. Test-only cap constants are not production policy.

## VISUAL OVERHAUL V3

- `Chog_Royale_Visual_Overhaul_Handoff_v3_CORRECTED/` is the art source of truth. Its references are direction only. Never install the flattened arena painting as a live background, and never crop the five-character poster into sprites. `docs/chog-visual-overhaul-readiness.md` tracks what is code ready versus art installed.
- Player-relative team colour is `TEAM_COLORS[structureTeamFor(owner, seat)]`: blue friendly at the bottom, red opponent at the top, for both seats. Never key a colour or side to a seat id.
- Camera-space arena layers (`CAMERA_SPACE_LAYERS` in `arena-registry.ts`: background, foundations, team-trim, foreground) stay upright for seat 1. Only board-coupled layers mirror. Adding a camera-space layer is valid only while the structure anchors mirror about y = 80.
- Top defenders always use `aim-south` and bottom defenders `aim-north`, including while firing or hit. Fire and hit are overlay cues from `defenderCue`, never pose swaps, because the authored fire and hit poses face sideways or toward the camera.
- Identity drift is a bug. Tower defenders must become recognizable Bulwark (red) and Chog Guardian (blue) art, and every redesign must still read as its v001 roster card.
- Animated unit sheets live in `public/assets/chog-units/v001` and are built by `tools/blender/chog-units-v001` (`build_units.py`, then `pack_units.cjs`). Two authored views, front three-quarter and rear three-quarter, both facing right and mirrored on X, with a shared ground pivot. The packer refuses frames that touch their cell border. The v001 static sprite stays the battle fallback.
- The rear view is the front view reflected through the screen-horizontal plane (yaw 180 - 24 plus `mirror_pose`), so one clip table drives both. `rearClips` must match `clips` in count, fps, loop and impact. The view comes from screen-space heading via `nextView()` and is presentation only. It must never feed movement, targeting or position, and seat 1's vertical flip has to be applied before choosing it.
- Unit masters render at 2x and the packer Lanczos-downsamples them to about 1 sheet px per board px, because the canvas backing is 500x800 and larger sheets only alias. Change display size through `targetBoardHeight`, never the hitbox, anchor or spacing.
- Unit animation state is presentation only, picked in `unit-anim.ts` from authoritative data: a stationary unit with a ground foe inside the ruleset reach (the same metric as combat `reach2`) swings once per `attackIntervalTicks`, an observed HP drop plays hit, and removal plays defeat. Never predict damage or targeting, and keep swing period and reach checked against `TROOP_CARDS_V1` by test.
- Troop allegiance rings use the same player-relative blue and red as the towers. Hit, deploy and status cues keep their own colours.
- All twelve troop cards have sheets. Slice 4 units are built by `build_roster.py` on `roster_lib.py` and set `rig["mirror_geo"]`, so the rear view mirrors the whole model and a one-handed prop stays in its posing hand. Keep Choglings and Boulderback on `build_units.py`, and check their sheets and portraits still repack byte for byte.
- Engagement counts flying foes only for units whose ruleset `hitsAir` is true (manifest `hitsAir`, tested against `TROOP_CARDS_V1`). Flying units hover over their ground pivot in the frames and never get a ground walk cycle.
- Set each unit's render px so the packed `displayScale` lands near 1.0, and use packer `trim` instead of tight hand-sized cells.
- Owner decision (Slice 4.1): every card interface (battle hand, loadout, deck builder, collection, commander cards) uses the original Chog Royale 2D illustrations. The 3D models are for deployed battlefield units and their animations only. `portraitCandidatesForCard()` returns only the v001 card derivative. Keep the generated 3D `card-portrait.png` files on disk, but never route them to a card.
- A static fallback troop's death fade runs in the removal loop, because `updateEnt()` only runs for entities still in the frame. Fixture ring samplers must skip faded sprites, or a dead troop gets matched to the killer standing on its spot.
- The Rift Sentry has no public fire event. Its recoil, muzzle flash and tracer come only from `stepSentry` (a replica of the server fire rule from public frames), and only when the target visibly lost HP or shield that tick. Never drive it from engagement alone, and keep the real-engine parity test passing.
- When a sheet is drawn upscaled (`displayScale` well above 1), repack it from its 2x masters with the packer's per-unit `down` factor instead of re-rendering. Units without `down` must still pack byte-identically.
- Live two-client acceptance uses an injected-auth copy of the real battle server plus an env-gated Privy stub alias in a temporary `next.config.ts`, kept outside the repo in `ChogRoyale-Assets/final-assets/live`. Never commit the stub or config change. Editing `next.config.ts` kills a running `next dev`. Building into another `distDir` rewrites `tsconfig.json` includes, so revert them and restart the dev server so `.next/dev/types` drops temporary routes. Production builds hide `window.__battleGame`, so in-engine census needs a dev build.

## BRAND

- The official logo pack v1 (owner ZIP, archived in `ChogRoyale-Assets/brand/logo-pack-v1`) is the brand source. Runtime copies live in `public/assets/brand/v1` as alpha-trimmed WebP so the intrinsic aspect ratio matches the painted logo. Always size logos by one dimension with `width: auto` or `height: auto`, never both.
- Stacked logo: the landing opening only, on violet. Its source mask keeps a dark patch behind the left crystals, so never place it on a light background until the owner supplies a cleaner export. Horizontal logo: the site header. Crown emblem: small decorative marks such as the footer. Keep headings, prose, card names and game UI labels as text.
- The hero has no visible wordmark because the header carries the logo. The `h1` keeps the sr-only "Chog Royale: " prefix before the headline.
- App icons come from the approved `CHOG_ROYALE_app_icon_1024.png` cropped 76 px per side to remove its baked rounded frame and dark corners. Icons are opaque RGB PNGs, but ICO entries must be RGBA PNGs or Next fails with "The PNG is not in RGBA format". The maskable 512 keeps the face inside the 40% safe circle.
- `src/app/manifest.ts` starts at `/app` with scope `/`, theme `#1d1458` (app top bar) and background `#241667` (app root). The theme colour goes through the root `viewport` export, not `metadata`.

## AUDIO ASSETS

- An unassigned production battle track is intentional silence through active play and results. Preserve null track choices through result transitions. Visibility recovery may resume a previously unlocked context once, but must never bypass mute or retry initial blocked autoplay endlessly. Clear cue-clock throttles when a shared AudioContext changes.
- UI SFX use the shared 16 semantic keys in `src/lib/audio/audio-assets.ts` and `audio-core.ts`: `primary`, `secondary`, `navigation`, `card-select`, `card-drag`, `placement`, `success`, `error`, `friend-request`, `notification`, `invite`, `ready`, `upgrade`, `reward`, `confirm`, `reveal`. Existing authoritative battle cues stay on the Web Audio engine.
- The shared UI fallback is one provider-owned document bubble listener. Semantic controls that play synchronously mark `data-audio-skip="true"` to avoid nested double cues. The fallback ignores disabled, typing, hover, scroll and passive route changes, and it plays `card-drag` only on an actual `dragstart`. Enabled same-origin framework links remain audible even when routing prevents their native click. Canceled buttons, modified/download/external links stay silent. Unlocking from a gesture never overrides mute or zero-volume preferences.
- Refresh autoplay recovery is gesture-driven. Do not render a provider-level Enable Sound prompt from `needsUnlock`; install temporary real pointer and keyboard listeners on `/app`, remove them on success or cleanup, and let only a stale autoplay resume be replaced by the first gesture. Repeated handlers from that gesture reuse the in-flight resume.
- ElevenLabs Free tier does not establish commercial entitlement. Until a paid/commercial account is verified, use the original local procedural fallback and make no ElevenLabs-generated claim.
- Track A must remain a true cyclic production loop with a measured wrap seam. Track B is the owner-supplied processed battle loop at `/assets/audio/v001/music/battle-loop.mp3`. Keep the original CC BY-NC 4.0 attribution, owner-asserted purchased-rights status and missing purchase documentation explicit. Do not substitute another soundtrack or place the original WAV in `public/`.
- Audio utility entry points remain intentional `.cjs` CommonJS scripts. Keep their `require()` lint exception file-scoped and remove unused analyzer imports or counters without changing generated formats or assets.

## MOBILE APP SHELL POLISH

- The authenticated `/app` layout owns the short branded opening overlay. It is shown only on the `/app` entry path so direct battle, invite, and recovery routes stay unobstructed. Shared providers remain mounted across route changes.
- Mobile HUD utility actions live in a native disclosure surface with touch targets of at least 44px. Desktop keeps the existing inline utility controls. Friends maps to the Profile tab because the fixed navigation has five supported sections.
- Account Level presentation has a card wrapper for Profile and a content-only mode for Progress. Both modes consume the same server-derived view and never infer level or XP locally.
- Audio gesture recovery may re-arm after a suspended context or page visibility change, but only for audible, unmuted preferences on a visible page. It never silently changes mute or zero-volume choices.
