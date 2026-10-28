# V2.1h Unranked AI Gold UI (2026-10-28, current)

- Doing: finish review and delivery of `codex/v2.1h-unranked-ai-gold-ui`, based on `v2.1g-bot-gold` `95899c5`.
- Done: Bot Gold validation/reducer, BattlePanel late-message lifecycle and balance refresh, BattleHud/BattleResult reward states, focused tests, scoped lint, typecheck and production build.
- Done: commit `d762aa8` is pushed on PR #16, https://github.com/Devendurance/ChogRoyale/pull/16. Vercel preview is building, while Production remains the prior main deployment. Do not apply migrations, deploy the battle server, enable the reward flag, merge or promote without owner approval.
- Limitation: `src/server/battle/bot-gold-flag.test.ts` still has an existing isolation failure when its flag-off and flag-on servers run together. Static `PracticeRoom.deps` is overwritten by the second server, so the flag-off case receives a pending message. No backend code was changed in this UI slice.
- Next: wait for PR/Vercel checks and owner approval. Preserve unrelated `.fast-build/STATE.md`, `DESIGN.md`, `demo-production/`, and docs files.

## V2.1g Unranked AI Bot Gold (2026-10-28, branch v2.1g-bot-gold 312c226, pushed, TEST migration only, flag OFF)

- Doing: shipped versioned fallback Gold backend slice, STOP after backend, no PROD migration/activation, no Card XP/Player XP/Chog Pass/Ranked/towers/$CHOG.
- Done: policy v1 (20/10/15, 5 per UTC day, 60s + 3 accepted human deploys), bot_matches evidence + bot_gold_awards ledger (0023/0024 on TEST only), independent replay verify, atomic UTC-day cap, idempotent per-match award, no fake bot participants, no matches/participants writes.
- Done: all balance/spend paths count approved bot Gold with missing-table guards; PracticeRoom pays only fallback origin with UNRANKED_BOT_GOLD_REWARDS_ENABLED=1; Codex bot_gold contract (eligibility, amount, cap status).
- Checks: bot-gold unit 12/12 + live flag ON/OFF 2/2, V2.1e fallback suites green, PvP gold/sponsorship suites green, tsc clean, scoped lint clean, production build pass.
- Known pre-existing TEST-branch residue failures, proven identical on pristine code: gold reconcile-short-ledger (136 short rows over limit 50), card-xp 2 reconcile tests. Needs owner-approved cleanup pass, never ad-hoc SQL.
- Next: coordinated rollout (apply 0023/0024 to PROD, deploy, enable flag) plus Codex reward UI; live authenticated acceptance needs a real Privy sign-in.

## V2.1e Unranked AI Fallback (2026-10-28, branch v2.1e-unranked-fallback 1096734, pushed, deployed scoped to endy-vps with flag OFF)

- Doing: shipped human-first Unranked queue with server-owned 20s bot assignment, STOP after backend, no UI/fallback-activation/Ranked/XP.
- Done: coordinator fallback engine (atomic claims, 50/50 medium/hard, one-shot key origin, capacity cap with honest retry), PracticeRoom fallback origin with forged-key rejection, no-reward isolation from the PvP settlement writer, ranked untouched.
- Checks: fallback unit 13/13 + live handoff 2/2, V2.1a/c suites green, PvP suites green (matchmaking/room 25), tsc clean, scoped lint clean, production build pass.
- Deploy: endy-vps restarted with zero live matches to disrupt, local + public /healthz ok, fallback log line reads disabled (release gate), secrets/proxy/tunnel untouched.
- Next: Codex V2.1f UI per handoff; coordinated production rollout to enable the flag after UI lands.

## V2.1c Three-Difficulty Practice AI (2026-10-28, branch v2.1c-practice-difficulties 2c25776, pushed, deployed scoped to endy-vps)

- Doing: shipped Hard/Ultimate server-owned practice bots, STOP after backend, no Codex UI/fallback/Ranked/XP.
- Done: hard (lane-threat defense, strict spells, coordinated pushes) and ultimate (support sniping, ability timing, hazard awareness) policies, same legal rules and deck for all; validated difficulty room option defaulting to medium; immutable per-room identity through lobby/start/reconnect/end.
- Fixed: practice tick loop follows the live socket across reconnects (stale-socket resume bug found by the new room test).
- Checks: unit 11/11 + room 4/4, V2.1a suite updated and green, PvP suites green (session/matchmaking/room 14), tsc clean, scoped lint clean, production build pass.
- Eval: 32 deterministic games across decks/seats, all replay-identical, mixed winners, no advantage claimed.
- Deploy: endy-vps user service restarted with zero live matches to disrupt, local + public /healthz ok, single instance, secrets/proxy/tunnel untouched, ranked closed.
- Next: Codex difficulty-selection UI per handoff; live authenticated three-difficulty acceptance needs a real Privy sign-in.

## V2.1b Practice Mode UI (2026-10-28, branch codex/v2.1b-practice-ui)

- Doing: reviewed and integrated the player-facing Practice Mode on top of V2.1a `54c3ad6`. Main integration and Production promotion are next after the scoped commit and PR checks.
- Done: Practice Arena hub card and route, Medium-only entry, real `battle_practice` creation with Privy Authorization, bot ready-room copy, AI HUD identity badge, player-relative result reuse, no-reward result state, Battle Again, Battle Hall exit, and mode-safe resume storage.
- Checks: focused UI/identity/result suites 37/37, Practice server contract 8/8, TypeScript clean, scoped ESLint clean, production build clean. No authenticated owner Privy match was run.
- Next: stage only scoped files, commit and push feature branch, open PR to `main`, verify checks and Vercel Production, then integrate with owner-authorized merge. Preserve unrelated `.fast-build/STATE.md`, `DESIGN.md`, `demo-production/`, messaging doc and V2 plan.

## V2.1a Live Practice Bot Foundation (2026-10-28, branch v2.1a-practice-foundation c54f2dc, pushed, deployed scoped to endy-vps)

- Doing: shipped bounded human-vs-AI practice slice, STOP after handoff, no V2.1b/fallback/XP/Ranked.
- Done: protocol BATTLE_PRACTICE_ROOM + MatchMode practice + bot opponent kind; practice.ts MEDIUM smartMove with turret/free-Bulwark deck; PracticeRoom single-human auth, internal bot seat, no settlement, no rewards; server registers practice room, PvP unchanged.
- Checks: practice 8/8, session/matchmaking/room regressions green (35+14), tsc clean, scoped lint clean, production build pass.
- Deploy: endy-vps user service restarted, health ok local + https://battle.endyos.xyz/healthz, secrets/proxy/tunnel untouched, single instance, ranked closed, settlement enabled for PvP only.
- Next: Codex V2.1b UI per handoff; live authenticated Practice acceptance needs a real Privy sign-in (not faked).

## Final audio overhaul (2026-10-28, delivery)

- Doing: delivered PR #9, https://github.com/Devendurance/ChogRoyale/pull/9, on codex/final-audio-overhaul from main 6907259. No merge or production promotion authorized.
- Done: persistent shared music/UI/battle mixer, 16 original procedural UI cues, server-confirmed interaction mappings, settings, legacy silence migration, cancellable music transitions and recovery. Track A is CC0 production lobby music. Track B remains CC BY-NC development-only.
- Checkpoints: 0190ec5 scope/state, b2d9c1f credited assets and 4ee0d88 reviewed integration pushed. Coordinator reviewed core, UI and assets from GPT-5.6 Luna/xhigh workers.
- Acceptance: 110 tests passed, clean production build passed. App browser checks 6/6, UI checks 15/15, real-provider audio phase assertions 7/7. Production smoke 17 assets 200, dev battle endpoint 404, no restricted bytes in 93 traces or injected QA strings in production chunks.
- Multiplayer: actual local engine, injected auth, shuffled seats 1/0, same-room refresh recovery, Endychog 2-1 Phantom result at 3:07. Playback remained unproven in that match; separate real-WebAudio phase fixture proves transitions. Final return assertion in the match harness used the wrong URL expectation.
- Limits: physical iOS/Android/PWA and subjective speaker/headphone listening remain unverified. ElevenLabs account is Free tier, no ElevenLabs output generated. Full lint retains 24 inherited errors/one warning.
- Checks: standalone typecheck and scoped lint passed. Next: owner review of PR #9, commercial permission before production Track B, physical-device/listening acceptance. Details in docs/audio/acceptance.md. QA aliases/routes removed, own 3100/2568/3101 services stopped, original 2567 untouched.
- Preserve unrelated .fast-build/STATE.md, DESIGN.md, demo-production/, messaging doc and V2 improvement plan. External source/QA evidence is under ChogRoyale-Assets/audio-overhaul-20261027.

## Audio refresh autoplay recovery (2026-10-28, complete)

- Doing: fix refresh behavior on `codex/final-audio-overhaul` without changing assets, settings design or battle rules.
- Done: removed the global floating Enable Sound button, added pointer and keyboard recovery listeners on `/app`, kept the intentional settings control, preserved mute and zero-volume silence, and made gesture recovery replace only a stale autoplay resume. Added listener and unresolved-promise regression coverage.
- Checks: focused audio tests 27/27, typecheck, changed-file lint and production build pass. Browser smoke reached `/app` before auth and showed no floating prompt on first load or refresh. Full lint retains 24 inherited errors and one warning. Full Vitest was stopped after unrelated public-site and database failures.
- Next: owner review of the pushed refresh fix. Do not merge or deploy automatically.

## Gameplay improvement V1 README bookmark (2026-10-27)

- Doing: add the owner's Drive gameplay recording as a clickable README bookmark on `codex/gameplay-improvement-v1`.
- Done: PR #8, https://github.com/Devendurance/ChogRoyale/pull/8. Owner rejected the reused old-game screenshot. Bookmark now uses the actual recording's Drive-generated thumbnail and opens `/preview`, with the Watch link matching. Thumbnail copied without modification. Subagent GPT-5.6 Luna/xhigh used, coordinator reviewed.
- Validation: actual thumbnail visually inspected, source/import hashes checked, Drive preview returns HTTP 200. GitHub Markdown rendering checked. Documentation/media-only change, no app tests/build rerun.
- Next: owner review of the documentation PR. Inline Drive video players aren't supported in GitHub README. No media reupload, sharing change or merge authorized.
- Base main `9dd3866`, owner merged PR #7. Preserve unrelated local files. No new merge/production promotion authorized.

## Final UX polish (2026-10-27, delivered)

- Doing: finished bounded polish on `polish/final-ux-identity-share`, PR https://github.com/Devendurance/ChogRoyale/pull/7. Owner approved PR #6 merge only. PR #7 stays unmerged, no production promotion.
- Done: PR #6 production READY, all 32 changed public assets hash-match. Checkpoints `ee2a587`, `7db7314`. All five acceptance areas pass within documented limits. Friends actions, 36 identity/crown fixtures, copy/share/login/setup/error cases verified. Two full injected-auth matches cover opposite seats, 1,800 ticks each, matching hashes/replayIdentical and zero errors. Actual invite refresh recovered the same seat.
- Checks: final 222/222 relevant tests, changed-file lint, standalone typecheck and production build with 65 pages pass. Full lint retains 24 existing errors and one warning in unchanged files. QA source/routes/config removed, production chunks contain no injected identities. Evidence and exact file list: `docs/final-ux-polish.md`.
- Final screenshot review replaced pre-texture startup captures with later live mobile frames and the verified resumed desktop frame. The clean fixture set covers every requested perspective/size. Local dev toasts are labelled in the report.
- Next: owner review of PR #7. Physical phones, real Privy/NFT/settlement and installed-app native sharing remain unverified. No further overhaul or feature slice is authorized.
- Preserved unrelated `.fast-build/STATE.md`, untracked DESIGN.md, messaging doc and demo-production/. External full QA set: `ChogRoyale-Assets/final-polish-20261027`. Original config files restored.

## V3 release acceptance (2026-10-27)

- Doing: release QA on PR #6 (`visual-overhaul/v3-final-assets`). Main (branding PR #5, 48a0eaf) merged in as 6329e08, no force-push. Never merge or deploy without owner approval (main auto-deploys).
- Done: Snare rim contrast, Totem plinth re-render, Scout/Reaver/Mortar repacked 1:1 (packer `down`), Sentry fire replica `stepSentry` with real-engine parity test. Five live two-client matches on the injected-auth real battle server (both seats, dev route on prod build, player route on dev build): identical state hashes, replayIdentical, 0 errors, 0 failed loads. Single-client A/B shows no per-frame cost from V3. Readiness doc section 17, evidence in `docs/visual-overhaul/review/acceptance/`.
- Next: owner art review and merge decision. Physical phone/touch, iOS Safari, Android, installed PWA, real Privy sign-in with NFT commanders in a live match are still unverified.
- Known: `card-xp.test.ts` and `legacy.test.ts` fail against the shared TEST database (data residue, server code identical to main). Live harness in `ChogRoyale-Assets/final-assets/live/` (live-match.cjs, live-battle-server.ts, perf-ab.cjs).

## Final 3D asset production (2026-10-26)

- Doing: buildings, spells, commanders, Burrow Scrapper and shared VFX on branch `visual-overhaul/v3-final-assets` (from main b3c0d7e, no upstream). Branding PR #5 still open. Draft PR only, never merge (main auto-deploys).
- Done: all 14 remaining assets plus `burrow_scrapper` animated and wired, battle VFX pack, 153/153 battle tests, three fixtures covering every building, spell and all ten abilities, both-seat and fallback captures with 0 errors. Readiness doc section 16, asset manifest, review in `docs/visual-overhaul/review/final/`.
- Work dirs: `ChogRoyale-Assets/final-assets/{masters,preview,review,qa}`. Fixture `qa/generate-final-fixture.ts` (run from the repo with `npx tsx --tsconfig tsconfig.json`), captures `qa/capture-final.cjs`, `qa/probe-clips.cjs`. The qa-units harness page is temporary and never committed.
- Next: owner art review. Live two-player match, phone/touch and real-device performance unverified.

## Main merge + official branding (2026-10-26)

- Doing: consolidate V3 on main and install the official logo pack v1 on branch `brand/official-logo`. PR only, no merge.
- Done: PR #3 merged by owner (main 41d2035, auto-deployed to production). LICENSE (MIT, owner terms unchanged) merged via PR #4, main b3c0d7e. `handoff/battle-experience-v2-20261025` already in main via squash 80f9e82 (identical tree), nothing to port. Branding: opening stacked logo, header horizontal logo, hero wordmark removed, footer crown, favicon/icon/apple-icon, manifest.ts with 192/512/maskable icons. tsc, scoped lint, build green, Chrome reports installable with 0 errors.
- Next: owner review of the branding PR and screenshots in docs/branding/review. Cleaner stacked logo export, real iOS Add to Home Screen test. Pre-existing stale `src/components/site/copy.test.ts` (expects /app/play, links are /app since 0666669) still fails 4 tests.

## Visual overhaul v3, slice 4.1 (2026-10-26)

- Doing: bounded identity correction of the Slice 4 roster on `visual-overhaul/v3-slice2` after `d7fb366`. Local commit only, no push, PR, merge or deploy.
- Done: Frostshell, Rift Runner, Sparkcaster, Gale Netter, Riftbreaker rebuilt toward their cards, Archer bow +15%, Guardian pauldrons. Seven sheets re-rendered, five byte-identical. Owner decision: original 2D card art in every card interface, 3D is battlefield-only (`portraitCandidatesForCard` returns v001 only, 3D portraits kept unused). Fallback ring mismatch root-caused (static death fade never ran) and fixed, 0 bad samples. Masters in `ChogRoyale-Assets/chog-units-v001/masters-s41`, review in `review-s41` and `docs/visual-overhaul/review/slice4-1/`.
- Next: owner review of the corrected units. Live two-login match, phone, touch and performance still unverified.

## Visual overhaul v3, slice 4 (2026-10-26)

- Doing: remaining ten troop cards on the Slice 3.1 pipeline, on `visual-overhaul/v3-slice2` after `04fffaf`. Local commits only (checkpoint `1838fbe` plus the Slice 4 commit), no push, PR, merge or deploy.
- Done: `build_roster.py` + `roster_lib.py` for all ten units, masters in `ChogRoyale-Assets/chog-units-v001/masters-s4` (with copies of the s31 Choglings/Boulderback masters), all twelve sheets and portraits packed, `hitsAir`/`air` in the manifest, `engagedFoe` air rule, portraits for all twelve. Battle tests 138/138, tsc, scoped TS lint, build green. Review set in `docs/visual-overhaul/review/slice4/` and `ChogRoyale-Assets/chog-units-v001/review-s4/`.
- Next: owner review of the ten new units and cards. Then buildings, spells, commanders and `burrow_scrapper`. Live two-login match, phone, touch and performance still unverified.

## Visual overhaul v3, slice 3.1 (2026-10-26)

- Doing: Choglings and Boulderback identity refinement plus a rear three-quarter view, on `visual-overhaul/v3-slice2` after `37a6c93`. Local commit only, no push, PR or deploy.
- Done: Chogling `sunburst()` spike disc, smaller face, separated eyes. Boulderback `plate()` flagstones, `rock()` boulders, dominant shoulders and forearms, smaller fists, claw toes, magenta blush. Rear view via mirrored pose at yaw 156, `rearClips` and `nextView()` in `unit-anim.ts`, 2x masters downsampled to board resolution, +12%/+8% display height, open hit ring for animated units. Tests 137/137, tsc, scoped TS lint, build. Review set in `docs/visual-overhaul/review/slice3-1/` and `ChogRoyale-Assets/chog-units-v001/review-s31/`.
- Next: owner review of both units, the rear view and the cards. Then the next roster cards through the same two-view pipeline. Live two-login match, phone and performance still unverified.

## Visual overhaul v3, slice 3 (2026-10-25)

- Doing: first animated Chogs (Choglings, Boulderback) on `visual-overhaul/v3-slice2`. Slice 2.1 is the approved arena/defender baseline, don't revisit it. Local commit only, no push, PR or deploy.
- Done: `tools/blender/chog-units-v001` (build_units.py, pack_units.cjs, card_check.cjs), sheets and card portraits in `public/assets/chog-units/v001`, `unit-anim.ts` (+ tests), BattleCanvas spritesheet wiring with v001 fallback, portrait candidates with v001 fallback, blue/red troop rings. Battle tests 135/135, tsc, scoped lint green. Review set in `ChogRoyale-Assets/chog-units-v001/review/` and `docs/visual-overhaul/review/slice3/`.
- Next: owner review of both units and card art. Then the other 23 cards and `burrow_scrapper`, spell VFX. Live two-login match, phone pass and performance still unverified.

## Visual overhaul v3, slice 2.1 (2026-10-25)

- Doing: defender identity correction and arena polish on `visual-overhaul/v3-slice2`, refining the existing slice 2 Blender scripts. Local commit only, no push, PR or deploy.
- Done: Bulwark (Corinthian helmet, V brow, striped crest band, black spikes, studded tunic, faceted star shield) and Chog Guardian (taller cream mask, black oval eyes, angled brow, faceted spike sunburst and rear starburst, thick scarf with back tail, layered plate, riveted blue-field shield) rebuilt in `build_mounts.py`. Tower masonry, quoins and crystal bezels. Arena ground hierarchy, flagstone lanes, river foam and glints, grey banks, bridge posts, clustered flora, warmer light. Tests 121/121, tsc, scoped lint, build green. Review set in `ChogRoyale-Assets/visual-overhaul-v3-slice2-1/`.
- Next: owner review of both defenders and the arena. Then Choglings and Boulderback atlases. Live two-login match, phone pass and the troop ring colour decision are still open.

## Visual overhaul v3, slice 2 (2026-10-25)

- Doing: asset reference pack v1 plus the first genuine production slice on branch `visual-overhaul/v3-slice2` from slice 1 commit 1e1fa56. Local commits only, with no push, PR or deploy without owner approval.
- Done: pack extracted to the repo root. v003 arena (12 procedural Blender layers) and four red/blue team mounts are installed with v002 as the fallback. `docs/chog-asset-production-manifest.json` is written and readiness doc section 10 is updated. Battle tests pass 121/121, typecheck, scoped lint and build are green. Both-seat captures and the fallback capture are in `ChogRoyale-Assets/visual-overhaul-v3-slice2/`.
- Next: owner art review of the arena and defenders (identity sheet `identity-vs-original.png`). Then Choglings and Boulderback atlases (idle, move, attack, hit, defeat) and their card art. A live two-login match and a phone pass are still unverified. The troop ring colour decision is still open.

## Visual overhaul v3, slice 1 (2026-10-25)

- Doing: v3 corrected handoff, Prompt 01 bounded slice on branch `visual-overhaul/v3-slice1` from origin/main 6307f1b. Local commit only, no push without owner approval.
- Done: handoff folder copied to repo root, `docs/chog-visual-overhaul-readiness.md`, player-relative orientation fix (red top/blue bottom pennants and tinted team-trim, camera-space layers upright for seat 1, defenders keep directional aim during fire/hit). Tests 115/115 battle, tsc, scoped lint, build green. Before/after two-seat captures in `C:/Users/USER/Documents/ChogRoyale-Assets/visual-overhaul-v3-slice1/`.
- Next: owner review and push approval. Then blocker 1 (approved-style arena layer pack on the v002 canvas), blocker 2 (Bulwark red and Chog Guardian blue defender mounts), then Choglings/Boulderback atlases. Owner decision pending on troop ring colours.

## Battle identity hotfix (2026-10-25)

- Doing: fix live name swap (Endychog/phantom both saw the opponent's name twice), keep self-blue/enemy-red per device, small mobile/desktop/result polish. Branch `hotfix/battle-identity-perspective` from origin/main 80f9e82.
- Done: identity helper + server `start.self`, tests (identity 5, session seat-shuffle naming), UI polish, two-perspective fixture captures in `C:/Users/USER/Documents/ChogRoyale-Assets/battle-identity-hotfix-20261025`.
- Next: owner review of PR. Battle server must be redeployed for `start.self`; until then the client falls back to the lobby by join slot. Live two-login acceptance and physical iPhone remain unverified.
- Local env: restored empty `node_modules/viem/node_modules/@noble/curves` (1.9.1, lockfile integrity match) so server session tests run again.

## Battle Experience V2 completion (2026-10-25, Devin)

- Doing: finish Codex's interrupted V2 on `handoff/battle-experience-v2-20261025` (base 4812c04, Codex 4dc44da/df0bbe5), push, open PR against main. No merge or deploy without owner approval.
- Done: desktop frame-fit board sizing and right-column regrouping, team crown chips, crown flight choreography fix (WAAPI whole-iteration easing bug) with landing-synced chime and +1 pop, VS start reveal, finale per-result differentiation with server-crown tally and settlement chip, lobby OWNED/BORROWED/LENT labels with loan expiry, far-Core label/flash clamp. Tests, typecheck, scoped lint green. Fixture captures and motion/audio evidence in `C:/Users/USER/Documents/ChogRoyale-Assets/battle-experience-v2-devin-20261025`.
- Next: owner review of PR and captures. Live two-login match, physical iPhone and subjective audio remain INCONCLUSIVE. qa-v2 harness stays uncommitted and must be deleted before any release commit.

## Responsive UI and audio rescue (2026-10-25)

- Doing: ship scoped responsive HUD, mode-specific entry, onboarding sizing and audible original battle cues to origin/main.
- Done: code fixes, reference inspection, 40 final five-size exact-component screenshots without overflow/image failures, 22/22 tap/drag/touch/resize checks, actual gesture audio capture and 19-cue offline output evidence. Existing auth routes render honest gates and Ranked stays closed. Temporary fixture source is archived outside the repo and removed from release code.
- Checks: 31 focused tests pass. Extra unchanged input unit suite is blocked by the installed viem/noble-curves import, with browser input independently passing. Scoped lint, full typecheck and the single production build pass, with all 62 pages generated and no fixture route.
- Next: physical iOS, live two-login play and subjective audio/visual approval. The scoped release is authorized for origin/main and Vercel. Evidence and limits are in docs/responsive-audio-rescue.md, with deployment identity in the external release-evidence.json.

## Named tunnel CONNECTED, DNS route owner-gated (state local, no repo changes)

- endy-vps named tunnel `chog-royale-battle` CONNECTED (fresh edge registrations yul01/ewr08). Service now runs `cloudflared tunnel run --token-file` (token only in 600 file, never in unit/logs/Git). Quick tunnel retired with it.
- Battle restarted with BATTLE_PUBLIC_URL=wss://battle.endyos.xyz, settlement ON, ranked closed; local /healthz ok.
- battle.endyos.xyz has NO DNS yet: owner must add public hostname route in Zero Trust (tunnel chog-royale-battle -> subdomain battle, domain endyos.xyz, service http://127.0.0.1:2567; auto-creates the CNAME). Then owner sets Vercel NEXT_PUBLIC_BATTLE_SERVER_URL=https://battle.endyos.xyz + redeploys, then two-login smoke.

- DNS: endyos.xyz is Cloudflare-managed, but battle.endyos.xyz has NO record and endy-vps holds NO Cloudflare credentials. Named tunnel needs owner action (API token with Zone DNS:Edit + Tunnel:Edit, or an owner-built tunnel). Quick tunnel stays live (URL unchanged, both services stable).
- Built /app/onboarding (username/display/avatar/wallet, server-authoritative, complete-only redirect) + guards on /app, /app/play, /app/play/battle + player-facing /dev/onboarding links rerouted. Model tests 3/3, touched suites green, typecheck/lint/build green.
- Owner left: Cloudflare token or prebuilt tunnel; Vercel env + deploy check; two-login smoke.

## P7.1 XP attribution hotfix (this session, committing)

- PROVEN live bug: d0029963 awarded 16 XP to seat-0 Endychog for seat-1 phantom's 34 deployments (unordered participants + players[cmd.player]). Gold correct, untouched.
- Fix: getAwardableMatch selects seat + ORDER BY seat ASC; pure seatOrderedPlayers() requires exactly seats {0,1}, fails closed otherwise. Regression test 3/3 pure (reversed rows, invalid seats, end-to-end attribution to deploying player). tsc+lint clean.
- PROD forensics (read-only): only 6 award rows exist, all d0029963, all wrong-owner; phantom progress empty; purchased all 1. Repair plan prepared, NOT executed (awaits owner approval).

- Fixes: landing Play CTAs -> /app; PlayHub real player via /api/players/me + resolvePlayer (was null); public battle gate = HTTPS WSS configured in prod (GameLobby + BattlePanel publicMode), dev gate untouched; PlayGuide stale currency line corrected.
- Verified: gate tests 3/3, typecheck, lint, prod build WITH tunnel URL and with EMPTY env (Vercel failure mode) both green.
- Live: chogroyale.vercel.app serves the hotfix (Play href="/app"); WSS healthy; PROD holds 2 replay-verified private matches + evidence (settlement proven live) and 10 players.
- Owner-gated: Vercel prod env values (Privy pair, DATABASE_URLs, NEXT_PUBLIC_BATTLE_SERVER_URL=tunnel URL), deploy green check, two-login private-match smoke + PROD settlement confirm.

## LAUNCH DAY: endy-vps LIVE, frontend+smoke owner-gated (state committed, runbook pushed)

- endy-vps (hermes.endyos.xyz, 4 CPU/7.8G/98G free, Node 24 via nvm) DEPLOYED: ~/apps/chog-royale @65e19e4, user-systemd battle+tunnel (enabled, lingering on), NO root used (no sudo). Quick-tunnel URL is ephemeral: CURRENT https://blacks-dish-sublime-clinic.trycloudflare.com (wss same). Settlement ON, ranked closed, legacy/scaling off. Health verified locally + externally + WSS 101.
- aws-hermes chog-royale-battle stopped + disabled (host/files/Caddy untouched). No migrations repeated. No unrelated services touched.
- OWNER LEFT: Vercel prod env (Privy pair + DATABASE_URLs + NEXT_PUBLIC_BATTLE_SERVER_URL=https://blacks-dish-sublime-clinic.trycloudflare.com), deploy green check, two-login private-match smoke, optional battle.chogroyale.xyz DNS to replace tunnel URL.

- `ssh endy-vps` STILL denied after owner added old pubkey. Root cause is client-side: ~/.ssh/id_ed25519 is passphrase-encrypted and BatchMode cannot unlock it (server log sequence proves it: key accepted, then signature never produced). Fix: generated passphrase-less ~/.ssh/id_chogdeploy; owner must authorize the NEW pubkey (below). Old key untouched.
- NEW PUBKEY TO AUTHORIZE: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINzoJKMxSYP+9SmNCELTe2RhN0oXvtGOy0YjK8AX/j3B chog-royale-deploy

- `ssh endy-vps` (and ubuntu@38.49.217.165) rejected for this machine's key (ED25519 SHA256:7xIzlAp...). Owner must append the client pubkey (in docs/endy-vps-cutover.md §0) or grant access another way. Nothing deployed to endy-vps yet; no guessing, no other-host changes.
- aws-hermes battle verified healthy (single clean start, NRestarts=0, gates correct) and remains the live endpoint until cutover.
- Cutover runbook ready: docs/endy-vps-cutover.md (inspect, transfer 65e19e4, pre-settlement health, proxy, DNS-or-nip.io, controlled cutover, rollback). Vercel env + smoke still owner-gated as before.

## LAUNCH DAY: battle server LIVE, frontend/smoke owner-gated (no push pending except state)

- Battle server PUBLIC: https://63-183-2-78.nip.io (WSS same host). VPS aws-hermes 63.183.2.78: Caddy auto-HTTPS + reverse proxy, systemd `chog-royale-battle` (enabled, restart-on-failure), code @65e19e4, settlement ON, legacy OFF, scaling OFF, ranked closed. /healthz verified locally and from outside.
- Vercel prerender fix pushed (65e19e4): dev /battle|onboarding|progress render honestly without Privy app ID; build passes with empty env.
- OWNER ACTIONS LEFT: (1) set Vercel prod env (NEXT_PUBLIC_PRIVY_APP_ID + PRIVY_APP_SECRET + DATABASE_URL/POOLED + NEXT_PUBLIC_BATTLE_SERVER_URL=https://63-183-2-78.nip.io) and confirm deploy green; (2) two-login private-match smoke; (3) optional DNS battle.chogroyale.xyz -> 63.183.2.78 to replace nip.io.

## LAUNCH DAY (owner directive, in progress)

- Vercel ERESOLVE fixed: `@types/node` 20 -> ^24.19.2 (package.json + lock together), lock-only resolve exit 0, typecheck + production build green, committed 60bf4f6 and pushed to origin main (was 2bce8e5). Vercel auto-build expected.
- PROD migrations 0010-0022 APPLIED to br-snowy-star-b5ftxkro after snapshot br-red-feather-b5xc380x. Verified: 9 players intact, journal through 0022, all tables present. No destructive ops (all additive; 0019 drops a just-added FK).
- npm on this Windows box is unusable for full installs (AV/file locks, orphan tsx from a prior session was holding node_modules; killed _diag-battle.ts + next dev). Toolchain repaired surgically (next package); tsc/vitest/tsx/drizzle-kit all work.
- BLOCKED on owner: (1) battle host target + access, (2) NEXT_PUBLIC_BATTLE_SERVER_URL in Vercel + deploy check, (3) two-player smoke (needs real Privy logins). No deploy, no host, no smoke done yet. Do not start P7b.

## P7a production-safe multiplayer host (complete, local commit pending, no push, no deploy)

- Fail-closed bootstrap: `resolveBattleHostConfig` (pure, tested) replaces the dev-only production refusal. Prod without `BATTLE_HOSTING_ENABLED=1` refuses; strict mode requires host/port/wss-URL/origins. Dev defaults untouched.
- Server: `/healthz` liveness on the transport express app, `installShutdownHooks`/`drainBattleServer` (sweeper stop + graceful drain, 15s cap). Windows termination bypasses handlers (verified); drain logic unit-tested.
- Local acceptance: refusal exits 1; prod-like boot serves `/healthz`; ranked stays closed; settlement/gold/XP/trophies disabled without tables. Auth/queue/modeseat guarantees verified unchanged. Runbook in `docs/P7a-hosting.md` with the exact deployment prerequisites. Do not start P7b.

## P6e.2 economy forensics and recovery safety (complete, local commit pending, no push)

- Root cause PROVEN: 5 fixture helpers hardcoded `level: 10`; `gold.test.ts fund(noXp, 2, 0)` wrote the exact (choglings, xp=0/level=10) orphan shape. Award/reconcile/derivation/upgrade paths exonerated. All fixed to `cardLevelForXp(xp)` plus a regression test.
- Cleanup gap PROVEN: in-process id-list cleanup plus TEST stalls orphan rows; today's slice runs also leaked 141 fixture matches and 3 negative-balance players (spends without earns from stalled cleanup). No deletes performed.
- Safety added: audit `settlement-evidence` coverage splits reconcile candidates (evidence-backed) from fixture residue (never award); reconcilers gate on type/verification/seats but not evidence, so the guard matters. Plan, reconciler map, anti-abuse prerequisites, and rejected-attempt contract in `docs/P6e-forensics-recovery.md`.
- Verification: pure audit tests 11/11, typecheck/lint/build green. DB suites INCONCLUSIVE (transient TEST Neon stalls; zero assertion failures, regression test passed when reachable). Do not start P7.

## P6e.1 economy integrity and abuse audit (complete, local commit pending, no push)

- Read-only operator audit: `src/lib/economy-audit.ts` (pure checks) + `scripts/economy-audit.ts` (`npm run economy:audit [-- --json] [--limit N]`). SELECT-only, TEST-guarded via `requireTestDatabaseUrl`, missing tables become NOT_CHECKABLE, no secrets in either rendering.
- Live TEST run: matches/gold/ranked/sponsorship tables empty, no suspect patterns; real FAIL on 2 `card_xp_progress` rows (xp=0/level=10, choglings) that match direct test-fixture writes, not app flow. No recovery attempted.
- Reconciliation plan in `docs/P6e.2-requirements.md`. P6e.1 enforcement thresholds are provisional and NOT APPROVED FOR ENFORCEMENT. Do not start P6e.2.
- Verification: audit tests 10/10, P6c route suite 3/3 on TEST, typecheck/lint/build green. Scoped files only; `.fast-build/STATE.md`, `DESIGN.md`, `docs/Chog Royale messaging.md` untouched.

## P6d card gifting and upgrade sponsorship UI (complete, local commit)

- Added `/app/gifts` with server-backed accepted-friend eligibility, 20-card catalog selection, quote and Gold reads, confirmation, UUID-safe sponsorship retries, domain-status messaging and sent/received history. Friends and Profile link to gifting.
- Focused gifts model tests 7/7, typecheck, scoped ESLint and production build pass. P6c route tests reached 13/14 before a TEST Neon connection timeout. Browser fixtures at 390x844 and 1366x768 show the honest Privy loading gate with no console errors or overflow. No live gifting or PROD claim.
- Scoped checkpoint committed locally. No push or deployment.

## P6c Gold card-upgrade sponsorship, complete (local commit, no push)

- Server-authoritative Model B sponsorship: `gift_sponsorships` receipt table (migration 0022, TEST only), single-statement atomic mutation in `src/db/sponsorships.ts` (advisory locks, idempotency, re-checked eligibility/XP/balance/caps), write/read/quote routes under `/api/players/me/gifts/sponsorships`. Sponsor Gold debits from the existing spend ledger; recipient advances one purchased level with earned XP, untouched XP. TEST caps 1/day, 3/week, 1 pair-card/week. No UI, no $CHOG, no PROD writes.

## P6b $CHOG purchase lifecycle: PREFLIGHT FAILED, stopped before implementation (local commit, no push)

- Mandatory preflight found 5 of 9 dependencies missing: no B4.6 authorization, no legal review, no merchant recipient, no SKU/price, no finality threshold. No migration 0022, no payment code, no orders, no entitlements, no tests. Only chain contact was read-only viem metadata on the candidate token (143, bytecode present, 18 decimals, CHOG, 1B supply) plus a proxy-shape flag. Evidence in `docs/P6b-preflight-report.md`. Nothing to implement until the owner unblocks in the listed order.

## P6a economy and card-gifting design contract, complete (local commit, no push)

- Wrote `docs/P6-economy-gifting-contract.md`: truth table, $CHOG catalog (cosmetic, deck slots, $CHOG sponsorship), Model B gift recommendation, payment/receipt architecture, anti-abuse minimums, slices P6b-P6g, 7 owner decisions, exact P6b contract. Design only: no code, migrations, purchases, mints, or PROD writes.

## P5f.2 NFT commander lending UI (complete, local commit)

- Added `/app/loans` with server-backed lend, borrowed, active/history, revoke and return views. Creation uses accepted friends, 1-7 day validation, one UUID idempotency key per intended submission, retry retention, visibility refresh and confirmation dialogs.
- Extended the existing authenticated commander read with server-owned loan basis metadata. Deck selection labels OWNED, BORROWED and LENT, blocks lent/expired/unavailable choices, and persists the existing NFT claim shape unchanged.
- Focused model tests 38/38, typecheck, scoped lint and production build pass. Fixture browser QA shows truthful schema/service-unavailable state at 390x844 and 1366x768, with no horizontal overflow and no console errors. No live NFT or production-schema acceptance claim.
- Scoped checkpoint committed locally. No push or deployment.

## P5f.1 secure NFT commander lending backend, complete (local commit, no push)

- Game-scoped loan delegation: `commander_loans` (migration 0021, TEST only), DAL in `src/db/lending.ts`, loan CRUD routes under `/api/players/me/loans`, borrowed-basis entitlement at ready and match-start lock, settlement accepts borrowed provenance, legacy still owner-only. No UI, no on-chain moves, no PROD writes. Do not start the lending UI.

## P5e.1 friendship age and card gifting foundation, complete (local commit, no push)

- Server-verified 30-day gift eligibility: `accepted_at` (migration 0020, TEST only), `canGiftToFriend` in `src/db/gifting.ts`, read API `GET /api/players/me/gifts/eligibility`. No transfers, mints, XP/Gold changes, UI or PROD writes.
- Card ownership finding: no transferable card inventory exists. Cards are global definitions plus account-bound XP/purchased levels and deck-slot claims. Minimal giftable-copy model proposed without an issuing source. Do not start P5e.2 transfers.

## P5d.2 clan UI and social integration, complete (local commit, no push)

- Added `/app/clans`, server-backed create/edit, pending invite accept/decline, accepted-friend invite picker, roster and role management, transfer, remove, leave and archive confirmations. Profile account actions link into clans without adding a sixth nav tab or changing the HUD.
- Verification: clan model tests 4/4, typecheck, scoped ESLint and production build pass. Browser route returned 200, but the unauthenticated fixture rendered the truthful unavailable state after a Privy app-config abort. Responsive checks at 390x844, 360x800 and 1366x768 had no horizontal overflow. No authenticated clan acceptance claim. Local checkpoint is committed, with no push.

## P5d.1 clan membership and governance backend, complete (local commit, no push)

- Clans, memberships, invites (migrations 0017-0019, TEST only), 11 explicit routes, no UI. Tests 20/20 clan plus 52/52 social regressions green sequential. Typecheck/lint/build green. Full-file reruns flake under sustained TEST-branch load (19/20 then 20/20, no code change). Do not start clan UI.

## P5c private messaging UI and social integration, complete pending commit

- Added the conversation opener route and neutral social-safety handling, plus `/app/messages`, Friends Message links, shared HUD Messages link, avatar/timestamp inbox rows, cursor paging, bounded visible polling, read acks and retry-safe sends.
- Focused tests: 36/36 across model, Friends, opener and messaging DAL suites. Typecheck, scoped lint and production build pass. Full lint still has the pre-existing P5b `route.test.ts` explicit-any error and existing `/dev/progress` image warning.
- Browser fixture smoke is honest service-unavailable at 390x844 and desktop, with no console errors. No authenticated messaging or production schema claim. Next: review staged diff, commit scoped files only, then report the forward-oldest pagination limitation and PROD migration blocker.

Last updated: 2026-10-24

## P5b real private messaging backend, complete (local commit, no push)

- DM conversations/messages (migration 0016, TEST only), idempotent sends, cursor pagination, recipient-only read acks, neutral unavailable errors, no UI. Tests 19/19 new, Friends/block regressions 33/33 green, typecheck/lint/build green. Do not start P5c.

## P5a player blocking and social safety, complete (local commit, no push)

- Directional blocks with friendship teardown, neutral unavailable errors, hidden search, shared guard, minimal UI, TEST migration 0015 applied to TEST only. Tests 16/16 new plus 17/17 Friends regressions green. Pre-existing battle-animation tsc/build breakage carried over, no new type errors. Do not start P5b.

## P4b character animation and battlefield motion, complete (local commit)

- Added authoritative animation cue projection and tests. Existing v001 static art now gets responsive spawn pop, movement interpolation with correction snap, directional facing, attack windup/release, HP hit emphasis, bounded death collapse/fade, event dedupe, reconnect priming and pooled cleanup on match reset.
- Preserved arena/HUD/audio/VFX/input/gameplay. No new animation assets or dependencies. Runtime manifest inspection found no animation frames or sheets.
- Verification: focused animation/render suites 54/54, typecheck green, full lint green, production build green. Localhost smoke reached the unauthenticated `/dev/battle` gate only. No live authenticated gameplay claim.
- Local checkpoint is committed with the scoped BattleCanvas, battle-animation helper/tests and state-log updates. Do not start P5.

## P4a essential battle audio, complete (local commit, no push)

- Added `battle-audio.ts` procedural cue engine and pure event projection tests. Cues use authoritative deploy/spawn, spell, tower/siege fire, impact, structure HP, death/destruction, commander ability, Chaos pulse, ack and result signals.
- Added compact battle HUD Sound toggle and volume control with browser-gesture unlock, local mute/volume persistence, reconnect-safe priming, dedupe, throttling and cleanup. Battle input, Phaser lifecycle and combat state are unchanged.
- Verification: focused tests 20/20, typecheck green, focused lint green, full lint green with one pre-existing `/dev/progress` warning, production build green after existing static-page retries. Localhost smoke reached the unauthenticated dev-battle gate only, so no live authenticated audio claim.
- Local checkpoint is committed. Preserve `.fast-build/STATE.md`, `DESIGN.md`, and `docs/Chog Royale messaging.md`. Stop after P4a.

## P3b player, patron and NFT progression integrity, complete (local commit, no push)

- Verified by inspection plus existing tests: deployment-independent stats, W/L/D correctness, private/casual/ranked separation, deployment-gated commander appearances, v2-only patron appearances, Paragon 9-vs-10 with idempotent reprocessing, invalid-evidence refusal, ownership checks. Fixed one proven gap: ranked bucket missing from stats byType (ranked rows settled but invisible in the breakdown).
- Scoped change: `getPlayerStats` ranked breakdown, dev progress Ranked row, new ranked-bucket test. Verification: progression 10/10, stats route 3/3, progress-model 29/29, typecheck, lint (1 pre-existing warning), build green. Live pool read-only: 1969 resolved, 0 invalid.
- Local commit: pending (scoped: progression.ts, progression.test.ts, dev progress page, agent-state). `.fast-build/STATE.md`, `DESIGN.md`, `docs/Chog Royale messaging.md` untouched. No PROD activation, no migrations 0010-0014, no push, no deploy.
- Next: owner review, including the still-gated live NFT-holder acceptance match. Do not start P4.

## Audio asset overhaul, current checkpoint

- Done: source audit, external master preservation, ElevenLabs Free-tier check, 16 canonical UI MP3 fallback cues, cyclic production Track A, dev-only crossfaded Track B, credits/manifest/quality docs, pure `audio-assets.ts` exports, dev route, tracing exclusion and focused asset tests.
- Verification: focused asset tests 2/2, scoped lint and typecheck pass. Production build reaches a pre-existing concurrent `GiftsScreen.tsx` parse error after the audio route config was corrected. Full build needs the coordinator's UI changes settled.
- Next: coordinator wires `UI_AUDIO_ASSETS` if static UI files are desired, re-runs the full build, and reviews the audio evidence. No commit or push was made.
## V2.1d Practice difficulty selector (2026-10-28)

- Doing: finish delivery from `codex/v2.1d-practice-difficulties`, based on V2.1c `8385910`.
- Done: accessible three-choice selector, typed `battle_practice` create options, server-authoritative difficulty display in lobby/HUD/result, reconnect and Battle Again retention, no-reward preservation.
- Verified: focused UI/identity/result 49/49, Practice server 23/23, typecheck, scoped ESLint, production build. No authenticated owner Privy matches run.
- Next: review explicit diff, commit/push, create and merge PR to `main` through GitHub, then confirm Vercel Production READY and smoke public routes.
## Owner-supplied battle music production release (2026-10-28)

- Doing: integrate the verified owner-supplied `.audio-dev/battle-loop.mp3` as production Track B from latest `origin/main` on `codex/owner-battle-music`.
- Done: exact checksum verified and copied to `public/assets/audio/v001/music/battle-loop.mp3`; Track B manifest/config and audio lifecycle tests updated; credits, manifest, quality report, acceptance report and AGENTS rules record owner-asserted purchased rights without claiming CC0. Focused audio tests 27/27, typecheck, scoped ESLint and production build pass.
- Next: stage only scoped files, commit and push, open the PR, merge with owner authorization already given in this request, verify Vercel Production READY and public asset 200. Report real browser playback as unverified unless an authorized session is available. Preserve unrelated dirty files.
# Current task: V2.1f Unranked AI fallback frontend

- Done: reviewed worker commits for queue handoff, lobby/HUD identity, result origin, separate resume slots, stale queue cancellation, and fallback result actions.
- Done: added coordinator fixes for explicit queue copy, timeout/handoff race protection, and fallback Back to Battle Hall navigation.
- Next: finish dependency-backed focused tests, typecheck, scoped lint, production build, then stage only V2.1f files plus state/rules docs, commit, push, open/merge PR, and verify Vercel Production. Keep backend fallback flag OFF.
- Preserve unrelated `.fast-build/STATE.md`, `DESIGN.md`, `demo-production/`, and the docs files already present in the worktree.
## V2.1f P0 blank-screen hotfix (2026-10-28)

- Doing: finish the hotfix on `codex/p0-unranked-ai-handoff`, then push, open and merge the scoped PR and verify Vercel.
- Done: fixed reservation handoff ordering, duplicate/cancel races, visible lobby hydration state, bounded `lobby_sync` recovery, and Practice/PvP room snapshot tests. Focused lifecycle/room tests 40/40 and typecheck pass.
- Next: run scoped lint and production build, commit only hotfix/state files, push and merge. Coordinate the exact `PracticeRoom`/`BattleRoom` VPS deployment because the remote server must include `lobby_sync` for replay recovery. No new gameplay or reward work.
