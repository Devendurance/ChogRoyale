# CHOG ROYALE — Product Requirements Document (PRD)

**Version:** 1.0 — locked product baseline  
**Date:** 2026-10-10  
**Product:** Chog Royale  
**Status:** Approved for implementation; numeric balancing values are versioned launch defaults, not immutable rules  
**Companion documents:** `TRD.md`, `architecture.md`, `projectplan.md`

## 1. Executive summary

Chog Royale is a mobile-first, browser-based, **real-time 1v1 competitive card battler** inspired by the accessibility of lane-and-tower strategy games, with its own characters, art, mechanics, lore, and user interface. Players deploy troops, cast spells, manage regenerating energy, protect their Core, and defeat their opponent. The differentiator is **verified Chog Genesis NFTs**: real NFT metadata creates a match's **Arena Patron and Chaos Pulse**, and ownership can unlock a personalized **NFT Commander**. Commanders also develop persistent battle histories linked to their NFTs.

**The principle: every Chog has a role; every player has a chance.** No one must buy an NFT or $CHOG to play, compete, acquire competitively relevant cards, or reach the top of ranked play. Ownership gives distinctive gameplay identities, access to special collection-related experiences, cosmetic/social status, and strategic diversity—not uncapped ranked statistical power.

The full vision includes identities, friends, direct/global chat with moderation, clans, leaderboards, card requests/gifts, social challenges, seasonal progression, optional $CHOG use, and **non-custodial temporary commander lending between established friends**. Agent-led development should parallelize independently shippable surfaces without sacrificing integrated end-to-end quality.

## 2. Challenge alignment and product positioning

- **NFT essentiality:** a verifiable Chog Genesis token's metadata determines the Arena Patron rules and holder-commander variant. Without an eligible NFT/its traits, an NFT-powered ranked arena cannot be instantiated as designed. The app validates chain/contract/token/metadata and records rule provenance; it does not simply decorate a standard game with NFT artwork.
- **Novelty (30%):** symmetric arena rules derived from an actual NFT; persistent token-linked commander histories; time-limited non-custodial social lending.
- **Fun (20%):** quick responsive battles, readable troop counters, climactic telegraphed Chaos Pulses.
- **Retention (20%):** daily changing patrons, seasonal ladders, quests, deck experimentation, friends and clans.
- **Clarity (15%):** login, identity, deck, match, earn, reconnect; visible explanation of each patron's effect.
- **Execution (15%):** deterministic server-authoritative combat, verifiable ownership, reliable matchmaking, working demo and testing guide.
- **$CHOG bonus:** real and optional utility, preferably within a carefully controlled nonholder catch-up/cosmetic economy.

**Context verified from public listings (2026-10-10):** Chog Genesis is an ERC-721 collection on Monad; OpenSea lists traits including `Aura`, `Background`, `Base`, `Body`, `Eyes`, `Form`, `Head`, `Mouth`, `Naked`, `Side`, `Skin`, `Tier`, and occasionally `Accessory`. These are visual metadata traits—not existing HP/attack stats. The collection address appearing on marketplace token listings is `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`; confirm with the Chog team or trusted official documentation before treating it as an allowlisted production identifier. Do not hard-code a market floor price.

## 3. Outcomes and success metrics

### Product outcomes
1. A first-time nonholder can create an account and finish a complete match without purchasing crypto or an NFT.
2. Two independent browsers/accounts can finish a real-time 1v1 match with server-enforced rules, synced state, correct win conditions, and recoverable disconnections.
3. A battle transparently uses a **real, valid Chog Genesis NFT** and shows which metadata caused its symmetric Chaos Pulse.
4. A genuine owner can import an NFT Commander; eligible friends can lend/borrow the commander temporarily while its NFT remains in the owner wallet.
5. Every meaningful player action (wins, ranks, purchases, leases, gifts) is abuse-resistant and auditable.
6. The game has enough social and progression depth to support return visits rather than a one-off demo.

### Launch telemetry targets (initial targets; revise after testing)
- Onboarding completion: >= 85% of successful logins claim a username and reach lobby.
- First-match completion: >= 80% of matchmaking entrants complete a battle.
- Server-validated fairness: zero client-authoritative HP/energy/outcome mutations.
- Critical 1v1 test: 20+ complete paired-client matches in staging, including reconnect/forfeit.
- Lease flows: no duplicated active entitlement or post-expiry use across adversarial integration tests.
- Record real unique players, match completions, returns on later days, holder conversions, and community feedback; avoid fabricated adoption claims.

## 4. Target users and accessibility

| Persona | Needs | Product promise |
|---|---|---|
| New/nonholder player | Play immediately, no $135+ barrier, fair progression | Free starter deck, guest-friendly Privy entry, competitive route to top |
| Genesis holder | Make NFTs useful and visible | Unique metadata commander, ownership recognition, battle history |
| Competitive strategist | Fair counters, predictable rules | Normalized ranked levels, replayable strategic decisions |
| Social player | Friends, clans, sharing, culture | Chat, battle invitations, gifts, safe lending after trust gate |
| Spectator/creator | Memorable highlights and NFTs to talk about | Patron spotlight, match results, shareable moments |

Mobile-first portrait is the primary control layout. Desktop widescreen is supported, with a centered arena and side panels. Accessibility requires readable contrast, non-color-only damage indicators, large touch zones, subtitles/text equivalents for sound cues, reduced-motion preference, safe-area support and no dependency on hover.

## 5. Core experience and navigation

**Primary journey:** Open site -> Privy login or wallet connection -> claim unique display name -> choose avatar -> view starter deck -> tutorial/practice -> enter ranked or friendly match -> meet Arena Patron -> deploy cards/react to Chaos Pulses -> result/XP/trophies -> view profile/friends/quests.

**Main navigation:** Home/Lobby, Battle, Cards/Decks, Social, Chog Vault (owned/borrowed NFTs), Store, Profile/Settings. Contextual surfaces: matchmaking queue, match result, NFT detail and provenance, commander lending, report/block dialogs, inbox, help/tutorial.

**Identity rules:**
- Privy supports social/email and external-wallet login; a user may link additional external wallets containing Chog Genesis NFTs.
- Server authenticates Privy session; an external wallet displayed in browser is not ownership proof on its own.
- Username is unique under normalized Unicode/casefold and reserved-word/profanity rules. Name changes use cooldown. Username and wallet address are not interchangeable.
- Player profile has avatar, status, rank, matches, trophies, badges, linked wallet visibility controls, and friend controls.
- No wallet purchase is needed to create an account or access normal battles.

## 6. Battle design — Chaos Crossing

### 6.1 Arena
- One original 2.5D illustrated arena at launch: **Chaos Crossing**; two lanes, two central bridges, a central Chaos Rift.
- Each side defends a **Core** and two **Beacons**. Beacons provide defensive attacks and protect routes to Core.
- Symmetric map geometry and deployment zones. Friendly-side deployment is allowed; enemy-side deployment only through explicitly introduced mechanics.
- Movement is lane/path graph based; attackers target troops/structures according to explicit priority rules. No direct manual steering after deployment.
- Projectiles, spell effects, troop animations and hit indicators are readable even on small screens.

### 6.2 Match parameters (initial balance profile `season-1-v1`)
| Setting | Initial value |
|---|---|
| Format | Live 1v1; practice vs bot; friend challenge |
| Normal time | 180 seconds |
| Overtime | Up to 30 seconds on unresolved tied objective |
| Deck | 8 troop/spell cards |
| Active hand | 4; drawn cyclically after each card is played |
| Energy | 10 max; base +1 every 2.8 seconds |
| Commander | Separate slot; one equipped; maximum one deployed instance; cost/cooldown set by class balance profile |
| Chaos Pulse | 00:45, 01:30, 02:15; telegraph before effect |
| Win | Destroy opposing Core; otherwise score by Beacon destruction, then Core HP %, then total structure HP %, else draw |
| Ranked levels | Normalized regardless of rarity, ownership count, purchase or card upgrade |

On reconnect, the battle continues server-side. A player receives a short grace window; if they do not return the system resolves consistently as disconnect/forfeit, never by accepting a client-reported win.

### 6.3 Cards: initial ten
| Card | Energy | Role and counterplay |
|---|---:|---|
| Choglings | 2 | Fragile melee swarm; counter by splash |
| Chaos Archer | 3 | Single-target ranged; counter by rush/flank |
| Boulderback | 5 | Slow high-HP tank; counter by swarms and focus fire |
| Frostshell | 4 | Defensive slowing tank; counter by ranged pressure |
| Rift Runner | 3 | Fast structure pressure; counter by interception |
| Sparkcaster | 4 | Ranged area damage; counter by quick melee |
| Chog Guardian | 4 | Versatile melee defender; no dominant matchup |
| Hexwing | 4 | Flying harasser; counter by anti-air |
| Chaos Bolt | 3 | Targeted direct-damage spell; counter by spacing/timing |
| Rally Horn | 2 | Temporary utility buff; counter by stalling/dispersion |

Rarity labels `Common`, `Uncommon`, `Rare`, `Legendary`, `Mythic` are collection/progression presentation categories subject to content design; **not a multiplicative ranked damage or HP bonus**. All mechanically relevant free-deck cards are earnable through play. The initial roster is 10 cards, and content architecture supports significantly more.

## 7. NFT-native gameplay

### 7.1 Arena Patron and Chaos Pulse (essential mechanic)
- Before matchmaking completion, the server selects a valid token from a configured allowlisted Chog Genesis token pool using an auditable/published policy, not player payments or owner pressure.
- Server fetches/validates collection, token existence, owner and token metadata, freezes a metadata hash plus ruleset version and rule outcome for that match; fallback/retry selects another verified token if provider fails. **Never silently invent an NFT or replace trait values**.
- A patron's `Aura` drives event family; secondary traits (e.g., `Eyes`, `Head`, `Body`) choose a bounded effect variant; unknown traits map to a documented safe default.
- Pulses are symmetric, time-announced, counterable, finite-duration, and do not generate unbounded RNG/score advantages. Examples: Ember Rift hazard, Frost Crossing slow tiles, Spark Surge charge zones.
- The battle UI shows patron name/token ID, artwork only if permitted, meaningful trait labels, effect preview and marketplace/explorer link.
- Persist `chainId`, collection, `tokenId`, metadata snapshot hash, trait-to-rules mapping version, event schedule, selection seed, and match ID for review and judge testing.

### 7.2 NFT Commanders
- Owning an allowlisted Chog NFT allows the player to instantiate a visually unique commander variant derived from **specific verified NFT attributes**.
- `Body` selects class (tank/bruiser/ranged/support mapping), `Aura` ability family, `Eyes` targeting style, `Head` a bounded special modifier, `Skin` visuals/defensive flavor, `Tier` rarity treatment and collector prestige, `tokenId` persistent identity. Actual mappings defined in a versioned trait registry, not invented as if metadata already contained combat statistics.
- Commander slot is separate from 8 regular deck cards. Nonholders receive a **free Rookie Commander** with equalized ranked effective power and meaningful counterplay.
- In ranked play, commander loadouts fit a standardized stat/ability budget. Rare combinations may be unconventional and valuable tactically, but do not grant automatic statistical supremacy.
- Owned NFT commander can be used by its owner **unless an active verified lease assigns gameplay use to a borrower**. Owner may still view NFT, badge and provenance while lent.
- History is associated with the chain + collection + token ID, preserving record across wallets/owners: appearances, wins, seasons, rivalries, achievements. Individual players' contribution credits remain separately attributed.

### 7.3 Holder status and progression
| Owned Genesis NFTs | Example badge | Noncombat benefit |
|---|---|---|
| 0 | Challenger | Full core competitive access |
| 1 | Guardian | Showcase + one personal commander |
| 2–4 | Captain | More owned commander choices and cosmetics |
| 5–9 | Warlord | Prestige, clan personalization |
| 10+ | Overlord | Collector recognition and social decor |

Counts are based on verified eligible tokens across linked, verified wallets, with duplicate counting prevented. Multiple NFTs expand **choices, not allowed simultaneous commander count or ranked raw power**. Holder perks never block nonholders from standard play or competitive ranking.

## 8. Commander lending — verified friends, zero NFT transfer

**Locked interaction:** temporary, exclusive **in-game use-right lending**, not NFT custody, staking or onchain rental. NFT stays in the lender's wallet. Only the Chog Royale backend recognizes/controls the temporary entitlement. The lender cannot deploy it during an active loan; the recipient can. This cannot stop an owner from using the underlying NFT in *other* applications or transferring/selling it onchain.

### 8.1 Eligibility policy (launch defaults, server-configurable)
- Accounts are mutually accepted friends **continuously for at least 30 × 24 hours**; unfriend, block or suspension resets/breaks eligibility.
- Both lender and borrower completed >= **30 verified, legitimate human PvP matches each** (bots/tutorials, surrendered-instantly matches, voided and collusive matches excluded). At least 10 qualifying matches must have occurred on distinct days as an anti-farm default; abuse review can disqualify suspicious clusters.
- Lender still owns NFT in a verified linked wallet on correct Monad chain/collection; NFT isn't already lent/locked/suspended.
- Borrower accepts the offer on their authenticated account; both parties are active and not sanctioned; lending isn't allowed between accounts flagged for self-dealing/fraud.
- The lender can offer 1–7 **whole-day durations** at launch, beginning upon borrower's acceptance. Pending offers expire after 24 hours.
- Maximum: **one active/pending loan per NFT**, **one borrowed commander per recipient**, **two simultaneously lent commanders per owner** (configurable).
- No fees, collateral, revenue share, NFT approvals, wallet custody or token transfers in v1. Paid leasing is not implied or permitted by the initial feature.

### 8.2 User flow
1. Eligible holder opens **Chog Vault -> Lend commander**, selects owned NFT and eligible friend, previews duration, terms and limits.
2. Backend creates a short-lived challenge describing `{chainId, collection, tokenId, lenderPlayerId, lenderWallet, borrowerPlayerId, startPolicy, durationSeconds, nonce, expiresAt, appDomain, rulesVersion}`.
3. Lender explicitly **signs a human-readable EIP-712 typed authorization** with verified owner wallet. Signature is authorization to Chog Royale only, not a blockchain transaction or ERC-721 `approve`.
4. Backend verifies authenticated lender, nonce, signature (including ERC-1271 path if contract wallet), onchain ownership, friendship tenure, battle counts and quotas; atomically records `pending_acceptance`.
5. Borrower is notified and must explicitly accept before pending TTL; server **rechecks all eligibility and ownership** in a serializable/locked transaction.
6. Lease becomes `active` until `startsAt + duration`; commander-entitlement selector switches from owner -> borrower. Both profiles show a clear countdown, loan receipt and audit trail.
7. At expiry, ownership change, friend block/unfriend, sanction or fraud finding, the lease becomes terminal and entitlement is disabled. Owner regains in-game use if still current owner and eligible.

**Term integrity:** normal terms are fixed; no unilateral early recall in-app simply to take it back. Mutual cancellation or moderator safety action may end a loan early. The NFT owner can still transfer the NFT onchain; transfer automatically invalidates in-game lending (it cannot be technically prevented by an offchain lease). Explicitly disclose this to both parties.

**Match consistency:** new matches and commander deployments require a valid entitlement. If transfer/expiry is detected during an existing short match, the already-approved match snapshot may finish (up to the match time cap), while *new match admission is immediately blocked*. Safety/moderation overrides can invalidate an ongoing match. This bounded policy prevents midmatch exploits while respecting entitlement changes.

**Lease UI states:** Not eligible (with transparent reason) / Eligible / Pending acceptance / Active (borrower + owner countdown) / Expired / Invalidated (transfer, friendship broken, moderation) / Cancelled by mutual agreement. Public profile can show **Lent to a friend** without exposing private linked wallet information.

### 8.3 Security and fairness guarantees
- No owner private key, NFT transfer, delegated token transfer approval, custodial wallet, or hidden staking.
- All entitlement decisions occur server-side; a borrowed commander ID supplied from browser is never trusted by itself.
- Atomic uniqueness and row-level locking prevent simultaneous conflicting loans or owner+borrower deployment admissions.
- Ownership rechecked at creation, acceptance, match/deck authorization and periodically/through transfer events; stale/onchain RPC failure means **fail closed for starting new NFT use or leases**, while basic F2P combat remains available.
- Anti-abuse: detect collusion, same-device farming, repeated opponent pairs, ultra-short battles, self-loaning wallet aliases; rate-limit offers/acceptances; audit with timestamps.

## 9. Social, community and retention

**Friends and social:** request/accept/unfriend, battle invite, presence if available, privacy preferences, block, mute, report, safe DM and global chat. Blocking immediately prevents messaging and leasing; moderation review can suspend privileges. Add rate limits, content filters, spam protection, abuse reporting, and age-appropriate safeguards; never launch unrestricted chat without abuse controls.

**Card requests and gifting:** player can request a specific eligible card. Friends may gift **duplicates** subject to per-card, per-day, friendship-age and sender/receiver caps. No granting purchased limited items, NFTs, commanders or rank-impacting resources through gifting; all transfers use an atomic inventory ledger. Invalid/collusive activity is reversible by admin tool and flagged for review. Gifting is not cash trading.

**Clans:** join/create and moderated clan chat; roles (owner/mod/member); clan showcase and friendly events; optional scheduled clan tournaments. Clan memberships do not confer battle power.

**Retention:** new Patron rotation, missions, trophy ladder, achievement unlocks, battle history, season ranking, cosmetic rewards, daily play incentives (without exploitative timers), NFT legacy stories, friend invitations and clan events.

## 10. Optional $CHOG economy

Official Chog site publishes $CHOG contract `0x350035555E10d9AfAF1566AaebfCeD5BA6C27777` on Monad; verify decimals, liquidity, token interface and payment processing onchain before rollout.

- **Nonholder catch-up store:** nonholders can optionally spend $CHOG to acquire **the same tactically useful cards earnable for free**. It accelerates choice, never provides exclusive highest-tier power. This preserves the original intention to give nonholders an alternative to expensive NFT ownership.
- **Everyone:** cosmetics, emotes, arena decor, profile customization and season visual themes may use $CHOG. NFT holders can earn all general gameplay cards through play; holder badge is not a PvP advantage.
- **Competitive invariants:** no premium-only card counters, no rarity/ownership purchase multiplier in ranked, no paid energy/stat boosts, no lootbox wagering/unstated chance probabilities, no play-to-earn income promises.
- Use fixed-price, clearly disclosed items, wallet confirmation, transaction and fulfillment receipts, idempotent settlement. Failed/reverted payment never issues items; reorgs and duplicate transactions require reconciliation.
- Token purchases are optional; no age-targeted pressure or investment language.

## 11. UX / visual identity

**Art direction:** vivid, playful, chaotic Chog-inspired fantasy, but **original** arena geometry, troop silhouettes, icons, animations, names and interface. Reference broad 2D/2.5D card-battler conventions without copying another game's protected character designs, distinct UI, branding, sound or artwork. Use Chog NFT image/brand assets only under confirmed rights/permissions from the relevant rightsholders; metadata and token ownership are not automatic commercial art licenses.

**Core screens:** landing/onboarding, unique-name claim, lobby, deck builder, matchmaking, arena, result, player profile, NFT Vault and provenance, friends/chat, lending offer/acceptance/countdown, quest/reward screen, optional store, settings/report tools.

**Sound:** short playful SFX, clear readable deployment/damage/pulse cues, adjustable audio, no intrusive background track. **Feel:** responsive drag-and-drop, tight hit feedback, particle bursts, clean hierarchy. Three.js is not necessary; Phaser renders 2D/2.5D sprites/effects.

## 12. Product priorities and release policy

We will **not** limit the number of agent workstreams simply because of a calendar. All features above are in the full-product scope. Nevertheless, enforce technical dependencies: the playable and verifiable core cannot be replaced by chat and decorative features.

**Core demo release gate:** Privy + unique identity; one polished arena and ten cards; working bot and two-human real-time 1v1; fully authoritative battle; verified live Chog Patron and Chaos Pulse; owner/NFT/commander proof; free fair nonholder route; battle history/provenance; responsive sound/visuals; three-minute demo and real usage evidence.

**Parallel full-scope tracks:** commander lending, friends/DM/global chat with controls, card gifting, clans, quests/seasons, $CHOG catch-up/cosmetic store, moderation and analytics. These may ship in the same sprint where integrations pass security tests. The team/agents should not call unfinished mocked features “delivered.”

**Definition of done:** fully wired UI + backend + database + chain verification, tested permissions/abuse paths, observable deployment, negative cases, docs, and playable end-to-end demo—not merely domain logic or attractive mockups.

## 13. Acceptance tests (product level)

1. A brand-new Privy email/social player gets a Monad wallet, claims unique name and enters free practice with no NFT purchase.
2. An external-wallet holder links/validates wallet and sees correct NFTs, metadata provenance, and allowed personal commander.
3. A nonholder and a holder each enter ranked with normalized effective stats; card counters work, with no raw holder advantage.
4. Two real clients deploy cards and see matching server HP/energy/timer, Chaos telegraph and outcomes.
5. Arena Patron token ID/attributes/ruleset come from an allowlisted real NFT, not a hard-coded demo-only fictional token.
6. Two accounts who are friends for 29 days cannot lend; at >=30 days and >=30 eligible battles each, they can; exact boundary tested.
7. Owner signs, recipient accepts, owner loses in-game commander use, recipient gains use for 1–7 days, and expiry restores owner access without NFT transfer.
8. Two simultaneous loan attempts cannot create duplicate active/pending rights; wrong signature, changed owner, wrong chain, expired nonce and blocked friendship fail.
9. A transfer/reorg/RPC outage suspends new borrowed use appropriately; future match admissions fail closed.
10. Messages, gifts, purchases, leaderboard writes and results cannot be forged from a browser; block/report/rate limits work.
11. Three-minute demo reproduces the NFT-essential moment, two-sided fair gameplay, and real user feedback.

## 14. Open configuration (NOT unsettled vision)

Defaults to tune with playtesting: exact card damage/HP and attack timings; commander stat budgets; map measurements; Chaos event durations; matchmaking rating tolerance; lease PvP minimum and owner/borrower quotas; season length; card-gift caps; store prices. These are **parameters for balancing**, not reasons to re-open the product's fundamental direction.

## 15. Sources and verification notes

The official hackathon rules in the project brief supplied by the participant are the source for judging weights, deliverables and schedule. External reference links:
- Official Chog site / $CHOG: https://chog.xyz/
- Chog Genesis collection metadata: https://opensea.io/collection/chog-genesis
- Example Genesis token / traits: https://opensea.io/item/monad/0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763/846
- ERC-4907 rental extension (reference only; not assumed implemented by Genesis): https://ercs.ethereum.org/ERCS/erc-4907
- Colyseus authoritative rooms: https://docs.colyseus.io/
- Monad developer network: https://github.com/monad-developers/

**Verification needed before mainnet integrations:** official collection contract attestation, NFT image/commercial use permission, complete trait-catalog snapshot, exact ERC-721 interface behavior, token decimals, and the supported wallet-signature pathways. No claims of implementation, production security audit, or current adoption are made in these specs.
