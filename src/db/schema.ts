import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  jsonb,
  integer,
  smallint,
  uniqueIndex,
  index,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const ACCOUNT_STATUSES = ["active", "suspended", "banned"] as const;
export const ONBOARDING_STATUSES = ["pending", "complete"] as const;
export const WALLET_TYPES = ["embedded", "external"] as const;
export const ROLES = ["PLAYER", "MODERATOR", "ADMIN"] as const;

export const players = pgTable(
  "players",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    privyDid: text("privy_did").notNull(),
    username: varchar("username", { length: 32 }),
    usernameKey: varchar("username_key", { length: 32 }),
    displayName: varchar("display_name", { length: 64 }),
    avatarId: varchar("avatar_id", { length: 64 }),
    accountStatus: text("account_status").notNull().default("active"),
    onboardingStatus: text("onboarding_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("players_privy_did_unique").on(t.privyDid),
    uniqueIndex("players_username_key_unique").on(t.usernameKey),
    index("players_account_status_idx").on(t.accountStatus),
    check("players_account_status_check", sql`${t.accountStatus} in ('active','suspended','banned')`),
    check("players_onboarding_status_check", sql`${t.onboardingStatus} in ('pending','complete')`),
    check(
      "players_username_key_format_check",
      sql`${t.usernameKey} is null or ${t.usernameKey} ~ '^[a-z0-9_]{3,20}$'`
    ),
  ]
);

export const playerWallets = pgTable(
  "player_wallets",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    addressNormalized: text("address_normalized").notNull(),
    chainId: integer("chain_id").notNull().default(143),
    walletType: text("wallet_type").notNull().default("external"),
    isPrimary: boolean("is_primary").notNull().default(false),
    linkSource: text("link_source"),
    metadata: jsonb("metadata").notNull().default({}),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("player_wallets_address_normalized_unique").on(t.addressNormalized),
    uniqueIndex("player_wallets_one_primary_per_player")
      .on(t.playerId)
      .where(sql`${t.isPrimary} = true`),
    index("player_wallets_player_id_idx").on(t.playerId),
    check("player_wallets_type_check", sql`${t.walletType} in ('embedded','external')`),
    check(
      "player_wallets_address_format_check",
      sql`${t.addressNormalized} ~ '^0x[0-9a-f]{40}$'`
    ),
  ]
);

export const playerRoles = pgTable(
  "player_roles",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    grantedBy: text("granted_by"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("player_roles_player_role_unique").on(t.playerId, t.role),
    index("player_roles_player_id_idx").on(t.playerId),
    check("player_roles_role_check", sql`${t.role} in ('PLAYER','MODERATOR','ADMIN')`),
  ]
);

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type PlayerWallet = typeof playerWallets.$inferSelect;
export type PlayerRole = typeof playerRoles.$inferSelect;

export const nftTokens = pgTable(
  "nft_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    chainId: integer("chain_id").notNull().default(143),
    contractAddress: text("contract_address").notNull(),
    tokenId: text("token_id").notNull(),
    tokenUriOriginal: text("token_uri_original"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("nft_tokens_chain_contract_token_unique").on(t.chainId, t.contractAddress, t.tokenId),
    index("nft_tokens_contract_token_idx").on(t.contractAddress, t.tokenId),
    check("nft_tokens_chain_check", sql`${t.chainId} = 143`),
    check(
      "nft_tokens_contract_check",
      sql`${t.contractAddress} ~ '^0x[0-9a-f]{40}$'`
    ),
    check("nft_tokens_token_id_check", sql`${t.tokenId} ~ '^[0-9]{1,78}$'`),
  ]
);

export const nftMetadata = pgTable(
  "nft_metadata",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    nftId: uuid("nft_id")
      .notNull()
      .references(() => nftTokens.id, { onDelete: "cascade" }),
    documentOriginal: jsonb("document_original").notNull(),
    name: text("name"),
    description: text("description"),
    imageOriginal: text("image_original"),
    attributesOriginal: jsonb("attributes_original"),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull().default("resolved"),
    error: text("error"),
    sourceUrl: text("source_url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("nft_metadata_nft_unique").on(t.nftId),
    index("nft_metadata_hash_idx").on(t.contentHash),
    check("nft_metadata_status_check", sql`${t.status} in ('resolved','failed')`),
  ]
);

export const nftOwnershipObservations = pgTable(
  "nft_ownership_observations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    nftId: uuid("nft_id")
      .notNull()
      .references(() => nftTokens.id, { onDelete: "cascade" }),
    ownerAddress: text("owner_address").notNull(),
    ownerNormalized: text("owner_normalized").notNull(),
    blockNumber: text("block_number"),
    blockHash: text("block_hash"),
    source: text("source").notNull().default("live"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("nft_ownership_nft_observed_idx").on(t.nftId, t.observedAt),
    index("nft_ownership_owner_idx").on(t.ownerNormalized),
    check("nft_ownership_source_check", sql`${t.source} in ('live')`),
    check(
      "nft_ownership_address_check",
      sql`${t.ownerNormalized} ~ '^0x[0-9a-f]{40}$'`
    ),
  ]
);

export type NftToken = typeof nftTokens.$inferSelect;
export type NftMetadataRow = typeof nftMetadata.$inferSelect;
export type NftOwnershipObservation = typeof nftOwnershipObservations.$inferSelect;

export const indexCheckpoints = pgTable("index_checkpoints", {
  key: text("key").primaryKey(),
  lastBlock: text("last_block").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nftTraitStats = pgTable(
  "nft_trait_stats",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    traitType: text("trait_type").notNull(),
    traitValue: text("trait_value").notNull(),
    nftCount: integer("nft_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("nft_trait_stats_type_value_unique").on(t.traitType, t.traitValue)]
);

export const commanderRulesets = pgTable("commander_rulesets", {
  version: text("version").primaryKey(),
  definition: jsonb("definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commanders = pgTable(
  "commanders",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    nftId: uuid("nft_id")
      .notNull()
      .references(() => nftTokens.id, { onDelete: "cascade" }),
    rulesetVersion: text("ruleset_version")
      .notNull()
      .references(() => commanderRulesets.version),
    tokenId: text("token_id").notNull(),
    class: text("class").notNull(),
    affinity: text("affinity"),
    stats: jsonb("stats").notNull(),
    abilities: jsonb("abilities").notNull(),
    variant: text("variant").notNull(),
    prestige: text("prestige"),
    sourceTraits: jsonb("source_traits").notNull(),
    unmatchedTraits: jsonb("unmatched_traits").notNull(),
    scores: jsonb("scores").notNull(),
    powerScore: integer("power_score"),
    contentHash: text("content_hash").notNull(),
    previousContentHash: text("previous_content_hash"),
    derivationCount: integer("derivation_count").notNull().default(1),
    derivedAt: timestamp("derived_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("commanders_nft_ruleset_unique").on(t.nftId, t.rulesetVersion),
    index("commanders_token_idx").on(t.tokenId),
    index("commanders_class_idx").on(t.class),
    check(
      "commanders_class_check",
      sql`${t.class} in ('bulwark','reaver','deadeye','scout','warden')`
    ),
  ]
);

export type CommanderRuleset = typeof commanderRulesets.$inferSelect;
export type Commander = typeof commanders.$inferSelect;

export const arenaPatronRulesets = pgTable("arena_patron_rulesets", {
  version: text("version").primaryKey(),
  definition: jsonb("definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One immutable row per ranked match: the server-selected patron, its trait
// snapshot, and every ruleset version needed to reproduce the battlefield.
// matchKey is the idempotency key (B3 match ID); rows are never updated, so
// history stays stable when metadata or rules change.
export const patronAssignments = pgTable(
  "patron_assignments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    matchKey: text("match_key").notNull(),
    nftId: uuid("nft_id")
      .notNull()
      .references(() => nftTokens.id, { onDelete: "restrict" }),
    tokenId: text("token_id").notNull(),
    rulesetVersion: text("ruleset_version").notNull(),
    commanderRulesetVersion: text("commander_ruleset_version").notNull(),
    serverSeed: text("server_seed").notNull(),
    patronConfig: jsonb("patron_config").notNull(),
    configHash: text("config_hash").notNull(),
    traitSnapshot: jsonb("trait_snapshot").notNull(),
    metadataContentHash: text("metadata_content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("patron_assignments_match_key_unique").on(t.matchKey),
    index("patron_assignments_token_idx").on(t.tokenId),
    index("patron_assignments_nft_idx").on(t.nftId),
    check("patron_assignments_token_id_check", sql`${t.tokenId} ~ '^[0-9]{1,78}$'`),
  ]
);

export type ArenaPatronRuleset = typeof arenaPatronRulesets.$inferSelect;
export type PatronAssignment = typeof patronAssignments.$inferSelect;

export const chaosRulesets = pgTable("chaos_rulesets", {
  version: text("version").primaryKey(),
  definition: jsonb("definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One immutable Chaos Pulse schedule per ranked match, derived from the
// match's patron assignment. matchKey references patron_assignments and is
// unique here, so a match can never hold two conflicting schedules. Rows are
// never updated; re-derivation returns the stored row.
export const pulseSchedules = pgTable(
  "pulse_schedules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    matchKey: text("match_key")
      .notNull()
      .references(() => patronAssignments.matchKey, { onDelete: "restrict" }),
    chaosRulesetVersion: text("chaos_ruleset_version").notNull(),
    patronRulesetVersion: text("patron_ruleset_version").notNull(),
    patronConfigHash: text("patron_config_hash").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    schedule: jsonb("schedule").notNull(),
    scheduleHash: text("schedule_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pulse_schedules_match_key_unique").on(t.matchKey),
    index("pulse_schedules_hash_idx").on(t.scheduleHash),
  ]
);

export type ChaosRuleset = typeof chaosRulesets.$inferSelect;
export type PulseSchedule = typeof pulseSchedules.$inferSelect;

export const nftLegacyEvents = pgTable(
  "nft_legacy_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    authorityKey: text("authority_key").notNull(),
    nftId: uuid("nft_id")
      .notNull()
      .references(() => nftTokens.id, { onDelete: "restrict" }),
    tokenId: text("token_id").notNull(),
    category: text("category").notNull(),
    matchId: text("match_id"),
    matchStatus: text("match_status"),
    payload: jsonb("payload").notNull(),
    rulesetRefs: jsonb("ruleset_refs").notNull(),
    source: text("source").notNull(),
    actor: text("actor").notNull(),
    supersedesEventId: uuid("supersedes_event_id"),
    status: text("status").notNull().default("recorded"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("nft_legacy_events_authority_key_unique").on(t.authorityKey),
    index("nft_legacy_events_nft_created_idx").on(t.nftId, t.createdAt),
    index("nft_legacy_events_match_idx").on(t.matchId),
    check(
      "nft_legacy_events_category_check",
      sql`${t.category} in ('patron_appearance','commander_appearance','commander_outcome','achievement')`
    ),
    check("nft_legacy_events_status_check", sql`${t.status} in ('recorded','corrected')`),
    check("nft_legacy_events_token_id_check", sql`${t.tokenId} ~ '^[0-9]{1,78}$'`),
  ]
);

export const legacyAchievements = pgTable("legacy_achievements", {
  code: text("code").primaryKey(),
  version: text("version").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  eligibility: text("eligibility").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nftAchievementAwards = pgTable(
  "nft_achievement_awards",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    nftId: uuid("nft_id")
      .notNull()
      .references(() => nftTokens.id, { onDelete: "restrict" }),
    tokenId: text("token_id").notNull(),
    achievementCode: text("achievement_code")
      .notNull()
      .references(() => legacyAchievements.code),
    evidence: jsonb("evidence").notNull(),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("nft_achievement_awards_nft_code_unique").on(t.nftId, t.achievementCode),
    index("nft_achievement_awards_nft_idx").on(t.nftId),
  ]
);

export type NftLegacyEvent = typeof nftLegacyEvents.$inferSelect;
export type LegacyAchievement = typeof legacyAchievements.$inferSelect;
export type NftAchievementAward = typeof nftAchievementAwards.$inferSelect;

// B3.2d account-saved battle loadout. One row per player today (slot 0;
// future extra slots relax the slot check, the unique index already scopes
// per slot). This is a selection claim only: no ownership, stats, entitlement,
// wallet or commander snapshot. NFT commander ownership is re-proven onchain
// by the battle server at ready and again at match start.
export const playerLoadouts = pgTable(
  "player_loadouts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    slot: smallint("slot").notNull().default(0),
    schemaVersion: integer("schema_version").notNull().default(1),
    cards: text("cards").array().notNull(),
    commanderKind: text("commander_kind").notNull(),
    commanderClass: text("commander_class"),
    nftChainId: integer("nft_chain_id"),
    nftContract: text("nft_contract"),
    nftTokenId: text("nft_token_id"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("player_loadouts_player_slot_unique").on(t.playerId, t.slot),
    check("player_loadouts_slot_check", sql`${t.slot} = 0`),
    check("player_loadouts_schema_version_check", sql`${t.schemaVersion} = 1`),
    check("player_loadouts_cards_count_check", sql`cardinality(${t.cards}) = 7`),
    check("player_loadouts_commander_kind_check", sql`${t.commanderKind} in ('free','nft')`),
    check(
      "player_loadouts_commander_shape_check",
      sql`((${t.commanderKind} = 'free'
          and ${t.commanderClass} in ('bulwark','reaver','deadeye','scout','warden')
          and ${t.nftChainId} is null and ${t.nftContract} is null and ${t.nftTokenId} is null)
        or (${t.commanderKind} = 'nft'
          and ${t.commanderClass} is null
          and ${t.nftChainId} = 143
          and ${t.nftContract} = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763'
          and ${t.nftTokenId} ~ '^[1-9][0-9]{0,77}$'))`
    ),
  ]
);

export type PlayerLoadout = typeof playerLoadouts.$inferSelect;

// B3.3a durable match settlement. Offchain results only: no ratings,
// rewards or NFT legacy rows are written here. A match row is only accepted
// when the stored live hash equals the replay hash (check enforced) and the
// evidence payload replayed independently before insert (application check),
// so every settled match carries verification 'replay-verified'.
export const matches = pgTable(
  "matches",
  {
    // Server-issued match id generated by the battle room at match start.
    id: uuid("id").primaryKey(),
    roomId: text("room_id").notNull(),
    matchType: text("match_type").notNull(),
    rulesetVersion: text("ruleset_version"),
    protocolVersion: text("protocol_version"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
    outcome: text("outcome").notNull(),
    winnerSeat: smallint("winner_seat"),
    endReason: text("end_reason").notNull(),
    crowns0: smallint("crowns_0").notNull(),
    crowns1: smallint("crowns_1").notNull(),
    ticks: integer("ticks").notNull(),
    liveHash: text("live_hash").notNull(),
    replayHash: text("replay_hash").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    verification: text("verification").notNull(),
  },
  (t) => [
    index("matches_settled_at_idx").on(t.settledAt, t.id),
    check("matches_match_type_check", sql`${t.matchType} in ('private','matchmaking')`),
    check("matches_outcome_check", sql`${t.outcome} in ('win','draw')`),
    check(
      "matches_winner_check",
      sql`(${t.outcome} = 'win' and ${t.winnerSeat} in (0,1)) or (${t.outcome} = 'draw' and ${t.winnerSeat} is null)`
    ),
    check("matches_crowns_check", sql`${t.crowns0} between 0 and 3 and ${t.crowns1} between 0 and 3`),
    check("matches_hash_equal_check", sql`${t.liveHash} = ${t.replayHash}`),
    check("matches_verification_check", sql`${t.verification} = 'replay-verified'`),
  ]
);

export const matchParticipants = pgTable(
  "match_participants",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "restrict" }),
    seat: smallint("seat").notNull(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    result: text("result").notNull(),
    crowns: smallint("crowns").notNull(),
    deck: text("deck").array().notNull(),
    commanderKind: text("commander_kind").notNull(),
    commanderClass: text("commander_class").notNull(),
    nftTokenId: text("nft_token_id"),
    // Locked CommanderIdentity snapshot at match start, immutable history.
    commanderIdentity: jsonb("commander_identity").notNull(),
    // Lowercase verified wallet that proved ownership at match start. Null
    // for free commanders and for rows settled before provenance tracking;
    // B3.3b requires it non-null for NFT legacy eligibility.
    entitlementOwner: text("entitlement_owner"),
  },
  (t) => [
    primaryKey({ name: "match_participants_pk", columns: [t.matchId, t.seat] }),
    uniqueIndex("match_participants_match_player_unique").on(t.matchId, t.playerId),
    index("match_participants_player_match_idx").on(t.playerId, t.matchId),
    check("match_participants_seat_check", sql`${t.seat} in (0,1)`),
    check("match_participants_result_check", sql`${t.result} in ('win','loss','draw')`),
    check("match_participants_deck_check", sql`cardinality(${t.deck}) = 8`),
    check("match_participants_commander_kind_check", sql`${t.commanderKind} in ('free','nft')`),
    check("match_participants_owner_check", sql`${t.entitlementOwner} is null or ${t.entitlementOwner} ~ '^0x[0-9a-f]{40}$'`),
  ]
);

// The replay evidence (config incl. seed, decks, commander slots, Chaos
// schedule + issued commands). Private by design: no API returns it.
export const matchEvidence = pgTable(
  "match_evidence",
  {
    matchId: uuid("match_id")
      .primaryKey()
      .references(() => matches.id, { onDelete: "restrict" }),
    formatVersion: integer("format_version").notNull(),
    evidence: jsonb("evidence").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
  },
  (t) => [check("match_evidence_format_check", sql`${t.formatVersion} = 1`)]
);

// B3.3b legacy processing marker. One row per settled match once the NFT
// legacy pass ran; absence means the match is due for (re)processing.
// details carries counts/skip reasons only, never wallets or seeds.
export const matchLegacyRuns = pgTable(
  "match_legacy_runs",
  {
    matchId: uuid("match_id")
      .primaryKey()
      .references(() => matches.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
    eventsCreated: integer("events_created").notNull(),
    details: jsonb("details").notNull().default({}),
  },
  (t) => [check("match_legacy_runs_status_check", sql`${t.status} in ('done','no-eligible')`)]
);

export type Match = typeof matches.$inferSelect;
export type MatchParticipant = typeof matchParticipants.$inferSelect;
export type MatchEvidence = typeof matchEvidence.$inferSelect;
export type MatchLegacyRun = typeof matchLegacyRuns.$inferSelect;

// B4.1 friendships. One row per player pair with canonical id ordering
// (user_a < user_b), so a pair can never hold two rows in either
// direction. requested_by records who sent the request and must be one of
// the pair. pending means requested_by's request awaits the other party;
// accepted means mutual friends. No self rows, enforced by the order check.
export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userA: uuid("user_a")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    userB: uuid("user_b")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("friendships_pair_unique").on(t.userA, t.userB),
    check("friendships_canonical_order_check", sql`${t.userA} < ${t.userB}`),
    check("friendships_status_check", sql`${t.status} in ('pending','accepted')`),
    check("friendships_requester_check", sql`${t.requestedBy} = ${t.userA} or ${t.requestedBy} = ${t.userB}`),
  ]
);

export type Friendship = typeof friendships.$inferSelect;
