# CRITICAL RULES - MUST FOLLOW


- Auto-log meaningful rules to the project’s AGENTS.md.
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

## BATTLEFIELD PRESENTATION

- B2.8g.1 environment polish stays outside the authoritative board. Non-interactive CSS atmosphere may frame the canvas, and Phaser mount shadows may ground existing structures, but the 100x160 transform, pointer mapper, deployment bounds and V002 layer geometry remain unchanged.
- Visual Core padding may lower only the authored mount assembly and its presentation labels. Keep the authoritative ground point, health model and weapon anchors fixed. Team accents must derive from `owner === seat` for both perspectives, with decorative pennants and halos kept inside the noninteractive canvas presentation.
- Combat VFX must key off authoritative event identity or observed authoritative HP change. Keep a bounded dedupe set, destroy temporary Phaser objects after their cue window, and never turn an advisory placement preview into a success effect.
- Fixture screenshots are presentation evidence only. Pointer/deployment delivery and touch behavior remain pending a real two-player regression.

## GAME APP SHELL

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

- Use GPT-6.1 Sol at low or medium reasoning for delegated project work unless the owner changes that preference.
- Keep battle shell styles scoped to `.chud` and `chud-` classes. Desktop hand placement must not reduce the board's height, and compact landscape rules must stay below the desktop breakpoint.
- Preserve the shared canvas-rectangle pointer mapper and stable Phaser instance. Presentation fixtures prove layout and callback behavior only, never authenticated multiplayer or server acceptance.
- Connection, error and recovery notices must remain visible inside the fixed HUD. Recovery actions reuse the existing session callbacks.

## NFT COMMANDER LENDING

- P5f.2 lending UI is server-authoritative. `/app/loans` uses only the existing loan routes, accepted-friend records and authenticated commander read. Never render loan party IDs or wallet data, never optimistically grant borrowed access, and keep `{ kind: "nft", chainId, contract, tokenId }` as the saved loadout claim.
- Borrowed commander options require server-returned active loan metadata and remain subject to the existing entitlement check at ready and match start. Lent, expired, revoked and returned options stay unavailable in the selector. Schema or service failures remain explicit unavailable states.
