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

## SPRITE KIT INVENTORY

- Derive asset scope from current implemented code, including spawned nondeckable units. Count primary entries, card-art derivatives and auxiliary VFX separately, and distinguish commander class templates from exact NFT artwork.
