# Left Off

Last updated: 2026-10-22

## Public site L8 seasonal opening (2026-10-22), awaiting owner review

- L7 built. Done: `SeasonOpening.tsx` + `opening.css`, mounted in `page.tsx` before the header. A fixed violet overlay over the pagoda hero: deep violet atmosphere with a gold horizon, the Reaver commander class art arriving from the upper right and settling tilted -8 degrees, the Chog Royale wordmark in gold bevel, then a dissolve into the hero that is already rendered underneath. No Three.js, no canvas, no new dependency.
- Plays on EVERY genuine visit to the landing page. Nothing is stored: no sessionStorage, localStorage, cookie or persistent flag. The component watches `usePathname()` and starts on the first mount and on any return to "/" from another route. It does not restart for a re-render, for scrolling or for an in-page anchor, because the pathname is the only dependency. Verified in the browser for fresh load, reload, and return from `/dev/battle`.
- Sequence is 2520ms: fade in 320ms, Reaver sweep 1040ms from 260ms, wordmark slam 480ms from 1180ms, dissolve 420ms from 2100ms. The whole cycle is ONE CSS animation on the overlay, so the intro still ends on its own if the script never runs, and `animationend` is what tears it down, so the fade and the teardown never drift apart. A JS timer is only a backstop.
- Accessibility: the overlay is a `role="dialog" aria-modal="true"`, focus moves to the Skip button, Tab stays inside it, Escape dismisses, the click target restores focus to `#main`, the scroll is locked while it plays and unlocked when it ends with a scrollbar-width compensation. The overlay is `pointer-events: none` except the Skip control, so the header and hero stay reachable. Reduced motion keeps the brand moment with no movement at all and a 1200ms cycle. Save-Data drops the drifting haze and shortens the cycle to 1900ms.
- Verified in Chrome at 360x800, 390x844, 1366x768 and 1920x1080: no horizontal overflow during or after the intro, no console errors, the Play link still points at /dev/battle. Typecheck, lint and one production build green.
- The Reaver is the approved commander class art, so the opening is a class-art moment and never a claim about a specific token. The real Chog Royale logotype and crest are still an open asset slot, so the wordmark stays the Lilita One fallback.
- Next: owner review of L8.

## Public site L8 acceptance check (2026-10-22), two defects fixed

- L8 built. Verified in the browser against a fresh load, a reload, a return from `/dev/battle`, scrolling, in-page anchor navigation, Skip, Escape, focus restore, reduced motion and a Save-Data path. Two confirmed defects were found and fixed, the rest passed.
- Defect 1: `aria-modal="true"` was a promise the overlay did not keep. It had `pointer-events: none`, so a pointer hit on the header Play link landed on the background link while assistive tech was told the background was inert. The overlay now takes the pointer, so the background is blocked the same way for mouse and for AT, and a click that lands on the overlay dismisses the intro so nothing feels dead.
- Defect 2: the Skip control was painted in the server HTML about 28ms before its click handler existed, so a fast click could hit a dead button. The control is now rendered only once the client is hydrated, using a `useHydrated()` store built on `useSyncExternalStore` with a false server snapshot. The server HTML has no Skip button at all, and the button fades in when it appears.
- Layout fixes confirmed: L5 has 142px of top padding, 186px below L4's last content, on a soft gradient seam. L6 has 142px of top padding and 254px below the L5 grid on its own white ground. The footer has no Royal Purple element left.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l8-review/` (`final-1366-opening.png`, `final-390-opening.png`, `final-1920-hero.png`, `accept.mjs`, `final-shots.mjs`). No console errors at any viewport.
- Next: owner review of L8, then L8 QA.

## Public site L7 closing CTA and mascot footer (2026-10-22), awaiting owner review

- L6 built. Done: `ClosingScene` (`#enter`) + `SiteFooter` + `closing.css`, mounted after the L6 bento. The CTA is white at the top so it continues the bento tail, washes up through mist and lilac, and returns to white for the footer's white band. One soft violet glow, no bevels, no mascot, type only, buttons reuse `.site-btn--primary` and `.site-btn--white` untouched.
- Footer structure follows DESIGN.md: 16px Royal Purple band, white top area with a 1.4fr 1fr 1fr 1fr grid (brand, Explore, Learn, Project), a bottom row with the copyright left and the fairness line right, then the fantasy scene.
- Copy: CTA eyebrow is the handoff Scene 07 title, heading is messaging 4.3, lead is messaging 1.7 first sentence, buttons are messaging 5.1. Footer tagline is messaging 1.1 and 1.2, statement is 1.5. The "Closed alpha" note sits next to the buttons and repeats the L5 wording, because `/dev/battle` is gated off in production builds. No new marketing claims.
- Footer links: the three external URLs are the ones already verified (chog.xyz, chogathon.chog.xyz, opensea.io/collection/chog-genesis). There are no verified social accounts, so the two DESIGN.md social squares are dropped and there are no social buttons. In-page anchors point at the five finished sections.
- Art: only approved class art. Warden, Reaver and Scout peeking over the front ridge at 18, 66 and 82 percent, with a visible chip outside the aria-hidden scene reading "Commander class art / Shared by every commander of these classes. Not a specific NFT." The scene's hills are CSS scallops, not the DESIGN.md fur artwork, and that is a known gap.
- Motion: hills parallax on scroll with the back layers moving less, the mascots rise once with a 120ms stagger and a spring ease, the sun pulses over 6s, the ring turns over 120s, the beads drift. Reduced motion and Save-Data drop every one of them and the back-to-top scrolls instantly.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l7-review/` (shots/, report.json). Screenshots at 390x844, 1366x768 and 1920x1080 for the CTA, the scene and the L6 to L7 transition, plus a full page at 1920 and a reduced-motion frame. No horizontal overflow at 360, 390, 820, 1366 or 1920, no console errors, all 14 footer links and both CTA links resolve, focus ring on the footer links and on the back-to-top button, the document ends on the scene with no white band. Typecheck, lint and one production build green.
- Known deviations: on a 390px screen the three Chogs sit at 16, 52 and 85 percent instead of 18, 66 and 82, because the brief's percentages overlap at that width.
- Corrections applied after the build agent handed back: the honesty chip moved out of the ridge line into the empty sky above it (it was sitting on the Warden's face at 360 and 390), the chip is now aligned to the footer's 1320px content grid, the brand column no longer repeats the two external links that the Project column already carries, and every L7 small-text colour moved from `--color-chog-ink-55` (3.98:1 on white, a real AA failure that DESIGN.md misstates as 5.6:1) to `--color-chog-ink-70` (6.65:1).
- Next: owner review of L7, then L8 season splash only.

## Public site L6 cinematic bento (2026-10-22), awaiting owner review

- L5 approved. Done: `BentoScene` (`#world`) + `BentoGrid` + `bento.css`. A 12-column asymmetric bento inside one white 28px-radius shell on a mist-to-white ground that pulls up into the L5 mist tail. Desktop rows: battle span 8 / deck span 4 (440px tall), then patron, social and lending span 4 (350px tall). Tablet 2 columns, mobile 1 column with the art as a band along the bottom of each tile.
- Art: only approved assets. Battle tile is a tableau: the Reaver class cutout with a violet aura and a soft ground shadow, a Rift Sentry card behind and a Chaos Comet card in front, both cropped by the tile's right and bottom edges, labelled "Commander class art / Reaver". Deck tile peeks Chaos Archer and Hexwing. Patron tile peeks Boulderback. Social and Lending carry inline SVG motifs only, no character art, because nothing is built for them yet.
- Copy: all NEW, not in the messaging doc. Every line is adapted from the doc (5.1, 5.8, 2.4, 7.2, 1.8, 1.3) or read against the shipped ruleset, and all of it needs owner sign-off. "Available now" on the three live tiles, "Coming later" on the two future ones. No ranked, rewards, leaderboard, season, XP, clan or lending-as-live claims, no $CHOG.
- Card frames keep the source art's own proportion, so the two deck cards never read as the same shape. One small gold rule above each status caption is the only gold in the section.
- Interaction: pointer parallax on the art (mouse only), tile lift plus sticker tip and card separation on hover, scroll rise on the five tiles with a stagger, a 10s aura breath on the battle tile. Reduced motion drops the entrance, the hover transform, the parallax and the breath. Save-Data drops the entrance, the parallax and the breath.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l6-review/` (after/, reduced/, report.json). Screenshots at 360x800, 390x844, 820x1180, 1366x768, 1920x1080 plus hover, focus and the L5 to L6 transition. No horizontal overflow, no console errors, no text and art collisions at any width, contrast 4.72 to 17.5. Typecheck, lint and build green.
- Next: owner review of L6, then L7 only.

## Public site L5 feature spotlight grid (2026-10-21), awaiting owner review

- L4 approved. Done: `SpotlightScene` (`#arena`) + `FeatureGrid` + `ChogCardMini`. Six cells on a shared 1px hairline grid (3 cols desktop, 2 tablet, 1 mobile), 12px violet "+" crosshairs at each cell's top-left and bottom-right, per-cell violet spotlight that follows the mouse and rises from .16 to .26 on hover, mini card tilt and lift. Heading "Read the Pulse. Break the Core." (messaging 1.3). No CTA, no focusable elements, no fake controls: the cells are content only, so nothing on the page looks clickable without being so.
- Art: approved v001 READY_STATIC showcase set (boulderback, rift_sentry, chaos_comet, frostshell, chaos_archer) plus the Bulwark commander class template, captioned "Commander class art" like L4. No new artwork, no token likeness.
- Copy: value lines from messaging section 6. Bodies adapted from section 6 and 2.3 and read against the shipped ruleset. Bodies and two value lines are NEW, cited in `copy.ts`, need owner sign-off. "Player progression" was dropped: there is no XP or level system, and match stats plus the casual leaderboard are empty because settlement is off.
- Honesty: section note says the battle, Arena Patron and free route run now, saved match history is not on yet. No ranked, rewards, leaderboard or lending claims.
- Interaction: pointer tracking is mouse-only, so a tap never leaves a spotlight stuck. Reduced motion drops the scroll-rise and the tilt transition. Save-Data drops the 3D tilt but keeps the lift.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l5-review/` (after/, reduced/, report.json). Screenshots at 360x800, 390x844, 820x1180, 1366x768, 1920x1080, plus hover and L4->L5 transition. No horizontal overflow, no console errors. Typecheck, lint, build green, vitest 640/640, /dev/battle free of site CSS.
- Next: owner review of L5, then L6 bento only.

## Public site L4 Collect scene (2026-10-21), awaiting owner review

- L3 approved. Done: `CollectScene` (`#commanders`) + `CommanderSpotlight`: one large commander class card (shared `ChogCard` frame, extracted from L3 unchanged), gold motes, breathing halo, mouse tilt, scroll entrance. A five-class picker flips the card to another class. Cost from `COMMANDER_COMBAT_PROFILE_V1`, role and active ability from `CLASS_ROSTER`. Reaver default.
- Art: v001 presentation-kit commander class sources (READY_STATIC, class_template), hashes match `cards.json`. Four new files in `public/assets/site/commanders/`, Reaver reuses the L2 mascot file. No exact NFT art or token data shown.
- Copy: heading 1.4, lead 2.2, "Play free first..." 4.5. Beats, fairness line and caption are NEW with code citations in `copy.ts`, need owner sign-off. NFT commanders labelled "In testing" (holder E2E never run).
- No CTA: no public commander route exists, `/dev/battle` stays gated.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l4-review/` (after/, reduced/). Lint, typecheck, build green. commanders/combat tests 79/79. /dev/battle regression clean.
- Next: owner review of L4, then L5 spotlight grid + bento only.

## Public site L3 card carousel (2026-10-21), approved

- L2 approved visually. Review corrections committed in `ac9262e`: `data-scroll-behavior="smooth"` set with the site's smooth scroll (Next 16 warning, route transitions animated), quieter Pillar 4 "In development" note, caption reads "Commander class art / Reaver".
- The red "1 Issue" in the owner's screenshots is a hydration mismatch from the Grammarly extension adding `data-gr-ext-installed` / `data-new-gr-c-s-check-loaded` to `<body>`. Not an app bug, not suppressed. Clean Chrome shows 0 issues.
- Done: `CardsScene` (`#cards`) + `ChogCardCarousel`: face-down deck, center card flips face-up, six READY_STATIC presentation-kit v001 cards copied to `public/assets/site/cards/`. Names, costs, types and traits come from live `CARDS_V1` via `site-cards.ts`. Autoplay 4.8s with pause button, pauses on hover/focus/hidden/off-screen, off for reduced motion and Save-Data. Arrows, buttons, dots, swipe and side-card click.
- Copy: heading "Build your first deck." (5.2). Lead and caption are NEW, built from live card counts, need owner sign-off.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l3-review/` (after/, reduced/, full/). Typecheck, lint, build green. Battle UI tests 55/55.
- Next: owner review of L3, then L4 Collect only.

## Public site L2 About scene (2026-10-21), approved

- L0/L1 approved by owner (hero art for development review only, not cleared for launch; wordmark is a temporary fallback; 3000px+ hero master is a pre-launch item).
- Done: `AboutScene` at `#how-the-chog-matters` overlaps the hero fade, white to mist to lilac wash, four messaging pillars as match-loop steps (Reveal, Understand and adapt, Clash, Remember), v001 Reaver commander class art peeking over the pillar panel. Pillar 3 and 4 text ADAPTED for honesty (no ranked; Match Recipe "In development"). All copy and provenance in `src/components/site/copy.ts`.
- Done: Satoshi self-hosted (unmodified official variable WOFF2 + FFL in `src/components/site/font-files/`), Fontshare link removed. Hero wordmark reduced to clamp(42px, 5.6vw, 80px). Hero text rise is transform-only so it counts for LCP.
- Evidence: `C:/Users/USER/Documents/ChogRoyale-Assets/site-l2-review/` (after/, reduced/). Typecheck, lint, build green. Battle UI tests 55/55. Local prod LCP 0.7-1.3s unthrottled.
- Next: owner visual review of L2, then L3 card carousel only.

## Public site L0/L1 (2026-10-21), approved

- Doing: public landing page, built in phases from the visual handoff (unzipped outside repo at `C:/Users/USER/Documents/ChogRoyale-Assets/visual-handoff/`). Stop after each phase for owner approval.
- Done: L0 tokens (`@theme` chog-* colors, font-site/data/game), Satoshi via Fontshare link, Georama + Lilita One via next/font scoped to `.site-root`, `MarketingHeader` (transparent to glass, mobile disclosure menu, Escape, skip link). L1 `HeroWorld` with proposed G pagoda image (wide + portrait crop, AVIF/WebP via next/image), scrims, eased fade to white, CSS petals/Ken Burns/scroll parallax with reduced-motion and Save-Data off paths, stub `#how-the-chog-matters` section as anchor target.
- Copy comes from `docs/Chog Royale messaging.md` section 5.1/1.5/2.3. Play CTA goes to `/dev/battle`, which is disabled in production builds unless `NEXT_PUBLIC_ENABLE_DEV_BATTLE=1`.
- Evidence: screenshots in `C:/Users/USER/Documents/ChogRoyale-Assets/site-l0l1-review/after/` (5 viewports, menu, keyboard, anchor, reduced motion, battle regression). Typecheck, lint, build, vitest 640/640 green.
- Next: owner approves L0/L1 screenshots, answers asset/rights questions (official logo, G image rights, higher-res G master). Then L2 About scene only.
- Known: no official logo (Lilita wordmark fallback), G source is only 1672x941 so tablet/phone crops look soft.

## Just finished

- B2.5 two-lane arena (ruleset v4, arena-v2): river, two bridges, RIFT_SHIFT ford, deterministic ground routing, lane objectives, target lock, territory + pocket deploys.
- B2.5 integrity hardening (ruleset v5): troops target commanders, solid structure footprints with detours, octile movement with carried remainder, legal-move bot runner, per-match entity ids, stronger replay tests.
- B2.6a commander card economy (ruleset v6): 7 ordinary + 1 commander card decks, deploy from hand for energy, no tick-0 spawn, hold-while-alive cycle policy, class-keyed runtime profile cp-v1 (free == NFT), tuned via real encounters. 249/249 tests + typecheck/lint/build green. Details in .fast-build/STATE.md.
- B2.6b player-controlled abilities (ruleset v7): the 5 actives fire only from validated AbilityCommands (ae-v1 costs 1/1/1 self, 2/2 area), deploy/onDeath triggers stay automatic, ability_ready/expired events, commanderAbilityStatus for a future button, bot policy botAbility. Full suite, typecheck, lint, build, scenarios, balance, runner green.

- B2.7a deployable buildings (ruleset v8): Rift Sentry (ground-only turret) and Decoy Totem (lure), solid footprints, crossing-mouth clearance, finite lifetimes, building-aware targeting. Full suite, typecheck, lint, build, scenarios, balance, runner green.
- B2.7b tactical cards (ruleset v9): Chaos Comet (delayed blast, 42 structure damage), Rift Snare (slow + chip), Rift Sprites (1e air pair), stale status-percent bug fixed, building matchup harness (npm run buildings:matchup). 295 tests, typecheck, lint, build, all scripts green. Details in .fast-build/STATE.md.
- Mirror fairness (ruleset v10): dev bot made side-neutral (per-player seeded lanes, mirrored depth, alternating first mover), zone band off-by-one fixed, engine mirror check 144/144, side wins now 36/36 and 35/37. Reaver is no longer weakest once the bot is fair.
- B2.7c1 (ruleset v11): Gale Netter (3e anti-air, 40 vs air, 12 vs ground) and Riftbreaker (4e demolition, 66 vs buildings, building-first targeting). Swarm spawn offset mirror bug fixed. v11 matchup (128 games) + engine mirror 128/128 x2. Neon DB test later passed in the full suite. Details in .fast-build/STATE.md.
- B2.7c2 (ruleset v12): Ember Mauler (4e, 220hp, radius-4 ground shockwave around itself, 24/swing, no air). Counters clustered cheap ground pushes; loses to flyers, ranged, tank-led pushes and melee duels. Swarm deck still 64/64 with or without it. Lane-swap check shows the engine and bot are side-neutral; the raw Chaos schedule is not. Full suite 28/28 incl. Neon.
- Ranked Chaos spatial fairness (ruleset v13): raw B1 zones were side-biased (Ember 128/169, Rift Shift 158/172 events across 6 trait sets x 50 seeds; Rift Shift skews to P1 home 139 vs 19). Combat now closes zones under the mirror with budget split. Also fixed Ember Rift damage, which never landed before v13. Raw side swaps 40/48 -> 48/48, lane-swap raw 31/40 -> 40/40. B1 schedules and hashes untouched.
- Neon test stabilization: the 3 assertion failures were leftover legacy fixtures from a cleanup hook that timed out (reproduced exactly). players.test.ts had no TEST routing and wrote to PROD, leaving 7 did:privy:test_ players (5 wallets, 9 roles) on PROD. Fixed routing + VITEST fail-closed guard + endpoint guard + self-healing batched cleanup + 60s hooks. TEST leftovers (4 players) removed. DB files together 58/58, full suite 354/354.
- B2.7c4 (ruleset v14): resource-aware smartMove bot + economy harness (npm run bots:economy). Smart beats simple 34/36. Swarm still dominates under both bots (simple 27/30, smart 30/30). Ablations point at cheap always-useful card density and the 4e scout commander, not energy waste or first-affordable play. Engine fix: footprint detour ties now mirror for P1.
- B2.7c5 calibration (npm run balance:calibrate): Scout 5e, Choglings 3e, Choglings 50 HP tested in isolation. HOLD, no shipped change, v14 kept. Only Choglings 3e moved swarm a lot and mostly under the simple bot. Revised control deck went 4/80 -> 44/80 with unchanged cards. Smart bot is seed-free, so no-Chaos smart samples are 10 distinct games per deck. Details in .fast-build/STATE.md.

## Currently working on

- Latest asset task is frozen after one c001 2D cutout prototype at `C:/Users/USER/Documents/ChogRoyale-Assets/chogling-2d-production/c001-cutout-prototype-20261019-154531/`. Done: approved m001 head retained, 11-layer ORA, linked-PNG SVG, rig JSON/scripts, eight-key walk 800 ms and punch 840 ms, 18 timed GIFs, 96 RGBA PNGs and phased squad previews. `REPORT.md` and `gallery.html` record evidence. Independent preservation passed 444/444. Method is promising, with readable rightward punch at 48/64 px. Candidate acceptance remains blocked by hip/torso joins, ankle cap lines and a short shuffle stride. Zero keyed stance drift and 2 px full-resolution filtered sole fringe apply only to discrete keys. Next: human art/motion review before a production layer set or more facings. Stop this iteration and keep r001/r002/r003 frozen. No atlas, Phaser/phone test, Tripo, 3D changes, gameplay edits or push.
- Latest asset task stopped after the bounded r003 rigid modular alternative at external `chogling-production/r003-modular-animation-20261019-143753/01-chogling-modular-animated.blend`. Done: rigid parts, joint covers, one assembly correction, 48 transparent frames, fixed-scale 128/96/64 px walk/punch loops, 98 integer/half-frame contact/rigidity samples and independent review. Quality remains blocked by exposed hip/knee cuts, shoulder seams and weak small-size punch. All eight GIFs decode to 24 frames/1000ms, 186/186 protected files unchanged. Next: review the failed evidence and use approved-view 2D cutout animation for the next method. Stop this 3D correction path. Intended foot motion is an asset test, not a Phaser/runtime test. No gameplay edits or push for this asset experiment.
- Latest asset task completed with bounded stop at external `chogling-production/r002-final-rig-20261019-061500/07-chogling-corrected-rig.blend`. Done: accepted 254-vertex belly reweight, stronger nine probes, durable packed-material fix verified after reopening, unchanged geometry/topology/UV hashes, preservation 124/124, crossing/clay/native-size evidence. Verdict blocked: right-walk face 2387 area ratio 0.0810277, punch shoulder volume loss and visible crossings. Punch reads guard-like at 128/96 px, bend/punch unreliable at 64 px, squat close to neutral. Next: user reviews blocked evidence before another asset correction scope. No gameplay edits or push. Earlier r001 notes below are source history.
- Chogling r001 cleanup and rig probe are in `C:/Users/USER/Documents/ChogRoyale-Assets/chogling-production/r001-cleanup-rigprobe-20261019-043633/`, separate from the protected source audit at `C:/Users/USER/Documents/ChogRoyale-Assets/chogling-3d-audit/textured-1beb2ae7-20261019-041632/`. Outputs: `04-chogling-cleaned.blend` without rig and `05-chogling-rigged.blend` with rig. Preservation validation passed 53/53 protected baseline files, including all three unchanged source GLBs. No game-code changes, regeneration, or push.
- Final geometry: 8,780 vertices, 10,544 triangles, 5,309 positional-weld vertices across 3 components, 66 boundary edges at the two fitted brow bases only, zero mesh/UV degenerates. Five small original boundary groups were closed with 23 cap triangles; original face-UV hash and packed pixels are unchanged. Crossings reduced 255→231 after caps and shoulder-root adjustment: 207 brow, 18 shoulder-root, and 6 other body pairs. Shoulder-root edit moved 101 internal vertices by max 0.006854; muzzle edit max +0.00587 Y. Do not call the 18 remaining shoulder-root pairs resolved or label them waist crossings.
- Rig probe: 16 bones, 15 deform bones, exactly one armature modifier, zero actions; all 8,780 vertices normalized. Nine static probes found no collapse below 10%, no coincident-seam tearing, head rigidity error max 1.28e-7. Posed body-crossing counts remain 24 neutral, 28 left, 31 right, 31 punch, 28 walk-left, 32 walk-right, 27 lean, 28 head, 39 squat after contact correction. Static stance contacts are about 1e-7, max squat gap 0.000058. This proves a static-deform feasibility prototype, not production animation, IK, or continuous-animation readiness.
- Report and gallery completed. Next asset task: resolve the remaining localized shoulder-root crossings and review texture polish before claiming animation readiness. Keep asset experiments outside the repository and preserve audit/source files.

- Original troop art direction c002 (2026-10-19): Choglings (A Bonk, B Ladle, C Prong) and Boulderback redesigned from the five r001 portraits. Outputs in `C:/Users/USER/Documents/ChogRoyale-Assets/original-troop-concept-review/c002/troop-concepts/`: art bible (A/B/C split), DNA evidence board, two troop sheets, side-by-side validation board, views, approvals (all pending), provenance, preservation check (175/175 baseline files unchanged). Hand-authored SVG, no AI image tool, no Tripo, no gameplay change.
- Next: user reviews c002. Open risks are the Boulderback front crest reading as a halo, the violet head ring reading as a hood, generic Chogling bodies, and no back views. c001 stays rejected.
- A separate session wrote a c002 source study in the parent `c002/` folder (README, character-art-bible, approvals, final-audit). It was left untouched.

- Completed `docs/character-reference-workflow.md`, a proposal for five NFT commanders and two original troops. All five metadata-derived classes and saved derivation hashes match. Original 1000x1000 portraits visually reviewed and preserved outside repo with genuine metadata evidence. Source/API review found no issues. Lint, typecheck, 261 tests, and production build passed.
- Next for asset production: review the workflow, implement the narrow read-only exporter, then approve full-body interpretations and troop concepts before Tripo generation. No exporter, full reference packs, or models generated in this research task.

- No game feature recorded as in progress here. Preserve existing game work in the working tree.
- Local Blender MCP setup verified end to end through scene inspection, `.blend` save, GLB export, and a 384x384 PNG render inspected through MCP. Test outputs are in `C:/Users/USER/Documents/ChogRoyale-Assets/mcp-verification-20261018`.
- Verification uses a separate Blender instance, PID 31608, with the bridge at `127.0.0.1:9876`. Original Blender PID 28880 was left untouched.

## Next up

- B3.1 playable alpha COMPLETE (8fdb762 room + client, c5c70fb drag/touch input). Closing match 0lc82opDV: drag, click, emulated touch, rejections, manual Scout abilities from both players, crowns win, replay hash identical. No PROD match/settlement/legacy writes. Real phone test pending (Chrome emulation only). Details in .fast-build/STATE.md.
- B3.2a loadouts + NFT entitlement (3c1dfca): accepted for planning. Custom-deck browser QA and NFT-holder E2E deferred to community testing, not performed.
- B3.2b unranked matchmaking: code done, automated tests green, human two-browser queue match still pending. Single in-memory MatchCoordinator (one battle-server process). Details in .fast-build/STATE.md.
- B3.2c activity exclusivity + 30s reconnect grace with Privy re-auth and rotating resume token: code done, tests green, browser reconnect test pending.
- B3.2d account-saved loadouts: code done, migration 0007 applied to TEST only, PROD migration needs user approval. Browser QA pending.
- Next: approve PROD migration, browser checks for B3.2a-d, then B3.3 settlement.
- User review of the B2.7c5 hold. Swarm and breaker share a cheap core (choglings, sprites, snare, archer, guardian, scout) and both still beat revised control 0/16. Spawner building still waits on that review. No matches have been written to any database.

## Known issues / open items

- PROD has 7 leftover test players (did:privy:test_<8hex>, created 2026-10-18 13:42-17:00) with 5 wallets and 9 roles from the unrouted players.test.ts. Deleting them needs explicit user approval. Real player (did:privy:cmvcak...) untouched.

- Balance is bot-measured only (32 games/class). v11 round robin: bulwark 15, reaver 19, deadeye 23, scout 13, warden 10 (v10: 16/18/18/15/13). Earlier reaver 9/32 came mostly from the biased bot. Commanders rarely outlive one cooldown in bot play.
- Units have no unit-unit body collision yet (overlap allowed).

- Human E2E at `/dev/onboarding` still unverified (Privy login, wallet sync, claim flow).
- Public-gateway throttling returns if ingestion is ever re-run hard; use single-stream path.
- `commanders/[tokenId]` for 1969 returns pending-404 style response only if metadata missing; all resolved now, but handler behavior unchanged.

## Latest asset checkpoint (2026-10-20)

- Doing: finalize approved static gameplay sprite kit v001 at `C:/Users/USER/Documents/ChogRoyale-Assets/gameplay-sprite-kit/v001/`. This checkpoint supersedes the earlier static art-review gate. Earlier frozen motion experiments remain historical and blocked separately.
- Done: current v16 roster reconciliation, 28 primary READY_STATIC, zero PROVISIONAL/MISSING/READY_ANIMATED, 25 cards, six VFX primitives for 26 requirements, five exact NFT sources, canonical Phaser manifest and measured scale/anchor manifest. Independent verification passes for all code IDs, 126 RGBA exports (121 transparent cutouts plus five lossless opaque NFT profile PNGs), 181 copied sources and JSON. Final offline previews reviewed, including all six fixed structure instances and 64/96/128 alpha-height comparisons. Presentation spec proposes authoritative-root-safe child transforms without implementation.
- Next: consume the static handoff in a separately scoped Phaser prototype, then verify gameplay readability, effect timing and a real phone. No runtime or phone validation has occurred. No new frame animation, atlas, Tripo, 3D, gameplay, backend, DB change or push in this task. Preserve concurrent game changes.

## Chaos Crossing arena v001 (2026-10-20)

- Done: external `C:/Users/USER/Documents/ChogRoyale-Assets/arena-worlds/chaos-crossing/v001/`, 13 aligned layers, eight defender poses plus eight derivatives, reusable tower/Core effects, mobile/desktop/battle/state previews and stable manifests. Engine arena-v2 geometry matches supplied100x160 baseline exactly. Final offline package validation passes,404 previous-kit files unchanged.
- Status: PROVISIONAL for visual acceptance. Ready for isolated Phaser visual prototype only. Defender east/southeast facing, Core rooftop seating, pose continuity and tiny mobile silhouettes remain unresolved. No runtime/device test, game/backend/DB edits, Tripo, Blender or push.
- Next: inspect `gallery.html` and `REPORT.md`, then separately authorize renderer integration. Preserve conditional ford using authoritative frame.riftOpen and keep source coordinates authoritative. Current500x800 renderer needs documented transform and cell-band convention reconciliation.
## Chaos Crossing v002 P0 polish (2026-10-20)

- Done: external arena-worlds/chaos-crossing/v002,16 aligned layers,18 separate mount images,12 static defender states,34 half-size texture candidates, fixed390x844/1440x1000/busy/before-after previews, stable-ID migration and measured anchors. Geometry unchanged, river/bridge files byte-identical to v001.481 protected prior-package files unchanged.
- Verdict: P0 PASS for offline static art/package handoff, ready for Phaser integration. New north/south aim drawings remain acceptance candidates, not continuous aiming or animation. Small overview defender detail, pose transitions, depth/health bars, real-device readability, event timing and renderer half-cell bands still require integration review. Raw RGBA texture estimate157.27MiB to39.32MiB is not a benchmark.
- Next: use external gallery.html, README.md, REPORT.md and manifests/layers.json plus mounts.json/display-proposal.json. No game/backend/DB changes, Tripo,3D, other worlds or push. Preserve concurrent engineering work and all v001 files.
## Gameplay presentation kit v001, both P1 milestones (2026-10-20)

- Done: external gameplay-presentation-kit/v001,20 ordinary playable card portraits +5 generic commander class cards READY_STATIC,5 exact NFT identity examples separate.10 ability +8 status icons and2 optional squad/spawner variants PROVISIONAL. No missing main card art.
- Done:32 READY_ANIMATED VFX,256 distinct transparent frames,32 matching strips/per-effect GIFs,10 PROVISIONAL child-motion templates. Six unique approved primitives reused through12 role copies. Combined offline proof100frames/10s600x1100 GIF+MP4, not combat replay.
- QA passed594PNGs,978manifestrefs,15doclinks,641prior-pack files unchanged. Compatible concurrent BattleHud source drift is an explicit provenance warning, captured hashes retained. Unrelated HUD/registry/probe working-tree changes preserved.
- Next: canonical manifests/presentation-kit.json and README.md. Asset integration can start.18 icons/2 variants need acceptance, six VFX bindings MISSING and26 PROVISIONAL. Ordinary attack/hit and tower/Core fire events absent, projectile snapshots are target positions without source/origin/arrival. Runtime/device/timing/cleanup remain untested. No game/backend/DB edits,Tripo,3D or push.