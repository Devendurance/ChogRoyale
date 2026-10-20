// B3.1 authoritative battle session. Transport-free so it is unit-testable;
// the Colyseus room is a thin adapter around it. All combat runs through the
// existing engine (initMatch/stepMatch, replayed with runMatch). Nothing here
// computes damage, energy, targeting or outcomes.

import { randomBytes, randomInt } from "crypto";
import { scenarioConfig } from "@/lib/arena-scenarios";
import { DECKS_V13 } from "@/lib/bot-economy";
import { deriveChaosSchedule } from "@/lib/chaos";
import {
  ARENA_V2,
  ARENA_VERSION,
  BUILDING_CARDS_V1,
  CARDS_V1,
  COMBAT_RULESET_VERSION,
  COMBAT_TIMELINE_V1,
  COMMANDER_COMBAT_PROFILE_V1,
  ENERGY_V1,
  SPELL_CARDS_V1,
  SPAWNED_TROOPS_V1,
  TICKS_PER_SECOND,
  TROOP_CARDS_V1,
  commanderAbilityStatus,
  energyPhaseMult,
  initMatch,
  rankedChaosZones,
  runMatch,
  spawnWavesFor,
  stateHash,
  stepMatch,
  type CombatCommand,
  type CombatConfig,
  type CombatEvent,
  type CombatState,
  type PlayerIndex,
} from "@/lib/combat";
import {
  BATTLE_PROTOCOL_VERSION,
  clientCommandSchema,
  type AckMessage,
  type BattleFrame,
  type CardInfo,
  type ChaosView,
  type CommanderIdentity,
  type EndMessage,
  type FrameEvent,
  type LobbyMessage,
  type SessionPhase,
  type StartMessage,
} from "@/lib/battle-protocol";
import {
  commanderCardId as engineCommanderCardId,
  isCommanderCard,
  validateDeck,
  type BuildingCardDef,
  type SpellCardDef,
  type TroopCardDef,
} from "@/lib/combat";
import type { CommanderGrant } from "@/server/battle/entitlement";
import { verifyLockedPatron, type LockedPatron } from "@/server/battle/patron-source";

/** Loadout suggestions derived from the B3.1 field decks. Advisory only;
 * players build their own 7 + commander and the server re-validates. */
export const PRESETS: Record<string, { cards: string[]; commanderClass: string }> = Object.fromEntries(
  Object.entries(DECKS_V13).map(([name, deck]) => {
    const cmdr = deck.find((c) => isCommanderCard(c)) ?? "";
    return [name, { cards: deck.filter((c) => !isCommanderCard(c)), commanderClass: cmdr.replace(/^cmdr:free-/, "") }];
  })
);

/** A player-built loadout after server-side entitlement resolution. */
export interface TrustedLoadout {
  /** The 7 ordinary cards, in the player's own order. */
  cards: string[];
  grant: CommanderGrant;
}

/** 8-card engine deck: the player's 7 ordinary cards, commander card last. */
export function deckFor(loadout: TrustedLoadout): string[] {
  return [...loadout.cards, engineCommanderCardId(loadout.grant.slot.commanderId)];
}
/** Per-seat command cap per tick; extra intents are rejected, not queued. */
export const MAX_COMMANDS_PER_TICK = 2;

export interface SeatPlayer {
  playerId: string;
  username: string;
}
export interface SessionRandom {
  seed(): string;
  int(n: number): number;
}
const cryptoRandom: SessionRandom = { seed: () => randomBytes(16).toString("hex"), int: (n) => randomInt(n) };

export interface ReplayRecord {
  config: CombatConfig;
  commands: CombatCommand[];
  players: [SeatPlayer, SeatPlayer];
  liveHash: string;
  replayHash: string;
  replayIdentical: boolean;
  winner: PlayerIndex | "draw" | null;
  endReason: string | null;
  ticks: number;
  /** Commander identity per seat, from the grants locked at match start. */
  commanders: [CommanderIdentity, CommanderIdentity];
  /** Seat-ordered verified owner wallets (lowercase) proven at match start. Null for free commanders. */
  owners: [string | null, string | null];
  /** The authentic indexed Chog Genesis patron locked at match start. */
  patron: LockedPatron;
}

interface Pending {
  seat: PlayerIndex;
  cid: string;
  cmd: { type: "deploy"; cardId: string; x: number; y: number } | { type: "ability"; abilityId: string };
}

export interface TickOutput {
  frames: [BattleFrame, BattleFrame];
  acks: [AckMessage[], AckMessage[]];
  end: [EndMessage, EndMessage] | null;
}

const PUBLIC_EVENTS = new Set([
  "deploy", "death", "shockwave", "structure_destroyed", "match_end", "spell_cast", "commander_deployed", "ability_fired", "ability_expired",
  "pulse_warning", "pulse_active", "pulse_expired", "rift_crossing", "building_spawned", "building_removed", "spell_impact",
  "unit_spawned", "spawn_skipped", "siege_fired", "tower_fired",
]);
const OWN_EVENTS = new Set(["command_rejected", "ability_ready"]);

// Descriptions are derived mechanically from the authored def fields; no
// hand-written numbers and no new rules.
function describe(card: TroopCardDef | SpellCardDef | BuildingCardDef): string {
  if ("lifetimeTicks" in card) {
    const b = card;
    if (b.shell) {
      const s = b.shell;
      return `Siege building, ${b.hp} hp. Lobs a shell every ${b.attackIntervalTicks / 10}s at enemy towers/Core first, then buildings, then ground troops, range ${b.minRange ?? 0}-${b.range}. Shell lands ${s.flightTicks / 10}s later: ${s.unitDamage} to units/buildings, ${s.structureDamage} to towers/Core, radius ${s.radius}, never air. Lasts ${b.lifetimeTicks / 10}s.`;
    }
    const attack = b.damage > 0 ? `, ${b.damage} damage every ${b.attackIntervalTicks / 10}s, range ${b.range}${b.hitsAir ? ", hits air" : ""}` : ", no attack";
    const spawn = b.spawnCardId
      ? ` Spawns ${b.spawnCount ?? 1} ${SPAWNED_TROOPS_V1[b.spawnCardId]?.name ?? b.spawnCardId} every ${(b.spawnIntervalTicks ?? 0) / 10}s, first after ${b.deployTicks / 10}s, up to ${spawnWavesFor(b)}, lasts ${b.lifetimeTicks / 10}s.`
      : "";
    return `Building with ${b.hp} hp${attack}. Lasts ${b.lifetimeTicks / 10}s, footprint ${b.footprint}.${spawn}`;
  }
  if ("count" in card) {
    const t = card;
    const parts = [
      t.count > 1 ? `${t.count} units` : "Unit",
      `${t.hp} hp`,
      t.damage > 0 ? `${t.damage} damage` : "no attack",
      `range ${t.range}`,
      `speed ${t.speed}`,
    ];
    if (t.moveType === "air") parts.push("air");
    else if (t.hitsAir) parts.push("hits air");
    if (t.splashRadius > 0) parts.push(`splash ${t.splashRadius}`);
    if (t.structPriority) parts.push("targets structures");
    if (t.slowPct > 0) parts.push(`slows ${t.slowPct}%`);
    if (t.targetPriority === "air") parts.push("prioritizes air");
    if (t.targetPriority === "building") parts.push("prioritizes buildings");
    return `${parts.join(", ")}.`;
  }
  const s = card;
  const parts = [`radius ${s.radius}`];
  if (s.damage > 0) parts.push(`${s.damage} damage`);
  if (s.buffPct !== 0) parts.push(`${s.buffPct}% buff for ${s.buffDurationTicks / 10}s`);
  if (s.impact) parts.push(`lands after ${s.impact.delayTicks / 10}s`);
  return `Spell: ${parts.join(", ")}.`;
}

function commanderDescription(cls: string): string {
  const p = COMMANDER_COMBAT_PROFILE_V1[cls as keyof typeof COMMANDER_COMBAT_PROFILE_V1];
  if (!p) return "";
  return `${cls[0]!.toUpperCase()}${cls.slice(1)} commander: ${p.hp} hp, ${p.damage} damage, range ${p.range}, speed ${p.speed}${p.armor > 0 ? `, armor ${p.armor}` : ""}${p.hitsAir ? ", hits air" : ""}.`;
}

export function cardCatalog(): Record<string, CardInfo> {
  const out: Record<string, CardInfo> = {};
  for (const t of Object.values(TROOP_CARDS_V1)) out[t.id] = { id: t.id, name: t.name, cost: t.cost, kind: "troop", air: t.moveType === "air", radius: 0, description: describe(t) };
  for (const s of Object.values(SPELL_CARDS_V1)) out[s.id] = { id: s.id, name: s.name, cost: s.cost, kind: "spell", air: false, radius: s.radius, description: describe(s) };
  for (const b of Object.values(BUILDING_CARDS_V1)) out[b.id] = { id: b.id, name: b.name, cost: b.cost, kind: "building", air: false, radius: b.footprint, description: describe(b) };
  // Display-only entries for spawned units: shown by id in frames, never deckable.
  for (const t of Object.values(SPAWNED_TROOPS_V1)) out[t.id] = { id: t.id, name: t.name, cost: 0, kind: "troop", air: t.moveType === "air", radius: 0, description: describe(t) };
  for (const [cls, p] of Object.entries(COMMANDER_COMBAT_PROFILE_V1)) {
    const id = `cmdr:free-${cls}`;
    out[id] = { id, name: `${cls[0]!.toUpperCase()}${cls.slice(1)} Commander`, cost: p.cost, kind: "commander", air: false, radius: 0, description: commanderDescription(cls) };
  }
  return out;
}

/** The ordinary (non-commander, deckable) cards the loadout picker offers.
 * Spawned units like burrow_scrapper stay display-only. */
const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

export function ordinaryCatalog(): CardInfo[] {
  return Object.values(cardCatalog()).filter((c) => c.kind !== "commander" && CARDS_V1[c.id] !== undefined);
}

export class BattleSession {
  phase: SessionPhase = "waiting";
  /** Join order slots; seats are assigned by the server at start. */
  readonly slots: Array<SeatPlayer | null> = [null, null];
  /** Confirmed loadouts per join slot; a non-null entry means ready. */
  private readonly loadouts: Array<TrustedLoadout | null> = [null, null];
  /** Set when both players are ready; loadouts can no longer change. */
  locked = false;
  /** Bumped on every lock/unlock so a stale async start cannot fire. */
  lockEpoch = 0;
  /** slot -> seat, set at start. */
  seatOfSlot: [PlayerIndex, PlayerIndex] = [0, 1];
  config: CombatConfig | null = null;
  state: CombatState | null = null;
  readonly commands: CombatCommand[] = [];
  replay: ReplayRecord | null = null;
  /** The locked Arena Patron for this match, set at start. */
  patron: LockedPatron | null = null;
  abortReason: string | null = null;
  private pending: Pending[] = [];
  private readonly cids: [Set<string>, Set<string>] = [new Set(), new Set()];
  private nextSeq = 1;
  private eventCursor = 0;

  constructor(private readonly rng: SessionRandom = cryptoRandom) {}

  slotOf(playerId: string): number {
    return this.slots.findIndex((p) => p?.playerId === playerId);
  }
  seatOf(playerId: string): PlayerIndex | null {
    const slot = this.slotOf(playerId);
    return slot < 0 || this.phase === "waiting" ? null : this.seatOfSlot[slot]!;
  }

  join(player: SeatPlayer): number {
    if (this.phase !== "waiting") throw new Error("Battle already started");
    if (this.slotOf(player.playerId) >= 0) throw new Error("Player already seated in this battle");
    const slot = this.slots.findIndex((p) => p === null);
    if (slot < 0) throw new Error("Battle is full");
    this.slots[slot] = player;
    return slot;
  }

  /** Waiting: frees the slot. Active: aborts without a winner or settlement. */
  leave(playerId: string): void {
    const slot = this.slotOf(playerId);
    if (slot < 0) return;
    if (this.phase === "waiting") {
      this.slots[slot] = null;
      this.loadouts[slot] = null;
      if (this.locked) {
        this.locked = false;
        this.lockEpoch += 1;
      }
    } else if (this.phase === "active") {
      this.phase = "aborted";
      this.abortReason = "Opponent disconnected. No result recorded.";
    }
  }

  /** Abort a live match without a winner (e.g. reconnect grace expired). */
  abort(reason: string): void {
    if (this.phase !== "active") return;
    this.phase = "aborted";
    this.abortReason = reason;
  }

  setReady(playerId: string, loadout: TrustedLoadout): boolean {
    const slot = this.slotOf(playerId);
    if (slot < 0 || this.phase !== "waiting") throw new Error("Not waiting for this player");
    if (this.locked) throw new Error("Loadouts are locked");
    // Rejects duplicates, unknown ids and extra/mismatched commander cards.
    validateDeck(deckFor(loadout), loadout.grant.slot);
    this.loadouts[slot] = loadout;
    return this.slots.every((p) => p !== null) && this.loadouts.every((l) => l !== null);
  }

  unready(playerId: string): void {
    const slot = this.slotOf(playerId);
    if (slot < 0 || this.phase !== "waiting") throw new Error("Not waiting for this player");
    if (this.locked) throw new Error("Loadouts are locked");
    this.loadouts[slot] = null;
  }

  /** Lock both confirmed loadouts for the async re-check before start. */
  lock(): number {
    this.locked = true;
    this.lockEpoch += 1;
    return this.lockEpoch;
  }

  /** Undo one player's ready and unlock (e.g. entitlement failed at start). */
  clearReady(slot: number): void {
    this.loadouts[slot] = null;
    this.locked = false;
    this.lockEpoch += 1;
  }

  /** Snapshot of the locked loadouts, indexed by join slot. */
  readyLoadouts(): [TrustedLoadout | null, TrustedLoadout | null] {
    const snap = (l: TrustedLoadout | null): TrustedLoadout | null => (l ? { cards: [...l.cards], grant: l.grant } : null);
    return [snap(this.loadouts[0]), snap(this.loadouts[1])];
  }

  lobby(slot: number): LobbyMessage {
    const mine = this.loadouts[slot];
    return {
      phase: this.phase,
      you: slot,
      locked: this.locked,
      players: this.slots.map((p, i) => ({ username: p?.username ?? "", ready: this.loadouts[i] !== null })),
      catalog: ordinaryCatalog(),
      presets: PRESETS,
      mine: mine ? { cards: [...mine.cards], commander: mine.grant.identity } : null,
    };
  }

  /**
   * Start after lock(): requires the same epoch (any unlock/leave in between
   * abandons it). `rechecked` carries the grants re-verified post-lock,
   * indexed by join slot.
   */
  start(epoch: number, rechecked: [TrustedLoadout, TrustedLoadout], patron: LockedPatron): void {
    if (this.phase !== "waiting" || !this.locked || epoch !== this.lockEpoch) {
      throw new Error("Loadout lock is stale");
    }
    // The re-check may refresh a grant but never change what was locked.
    for (const s of [0, 1] as const) {
      const locked = this.loadouts[s];
      const r = rechecked[s];
      if (!locked || locked.cards.join(",") !== r.cards.join(",") || locked.grant.slot.commanderId !== r.grant.slot.commanderId) {
        throw new Error("Loadout changed after lock");
      }
      validateDeck(deckFor(r), r.grant.slot);
    }
    this.loadouts[0] = rechecked[0];
    this.loadouts[1] = rechecked[1];
    // Server-controlled seats, seed and Chaos patron. The seed never leaves the server.
    // The patron is an authentic indexed Chog Genesis token locked by the
    // room; a tampered snapshot fails closed (no synthetic fallback). The
    // session deep-copies it so later mutation of the caller's object can
    // never change the live config.
    verifyLockedPatron(patron);
    this.patron = JSON.parse(JSON.stringify(patron)) as LockedPatron;
    this.seatOfSlot = this.rng.int(2) === 0 ? [0, 1] : [1, 0];
    const seed = this.rng.seed();
    const schedule = deriveChaosSchedule({ patron: this.patron.config, serverSeed: seed, matchKey: `arena:${this.patron.tokenId}` });
    const deckOf = (seat: PlayerIndex) => deckFor(rechecked[this.seatOfSlot.indexOf(seat)]!);
    const slotOf = (seat: PlayerIndex) => rechecked[this.seatOfSlot.indexOf(seat)]!.grant.slot;
    this.config = scenarioConfig(deckOf(0), deckOf(1), schedule, seed, [slotOf(0), slotOf(1)]);
    this.state = initMatch(this.config);
    this.phase = "active";
  }

  startMessage(slot: number): StartMessage {
    const seat = this.seatOfSlot[slot]!;
    const opp = this.slots[this.seatOfSlot.indexOf((1 - seat) as PlayerIndex)]!;
    const grant = this.loadouts[slot]!.grant;
    const catalog = cardCatalog();
    // The player's own commander card uses the identity name (e.g. an NFT's
    // "CHOG #1462 · Scout"); the opponent's commander is never listed here.
    catalog[grant.identity.cardId] = {
      id: grant.identity.cardId,
      name: grant.identity.kind === "nft" ? `${grant.identity.name} · ${cap(grant.identity.class)}` : grant.identity.name,
      cost: COMMANDER_COMBAT_PROFILE_V1[grant.slot.definition.class].cost,
      kind: "commander",
      air: false,
      radius: 0,
      description: commanderDescription(grant.identity.class),
    };
    return {
      protocol: BATTLE_PROTOCOL_VERSION,
      ruleset: COMBAT_RULESET_VERSION,
      arena: ARENA_VERSION,
      seat,
      opponent: opp.username,
      deck: [...this.config!.decks[seat]],
      commander: grant.identity,
      // Public NFT metadata only; never ownership or seeds.
      patron: {
        tokenId: this.patron!.tokenId,
        name: this.patron!.name,
        tier: this.patron!.config.tier,
        theme: this.patron!.config.theme,
      },
      catalog,
      geometry: {
        width: ARENA_V2.maxX,
        height: ARENA_V2.maxY,
        river: { ...ARENA_V2.river },
        bridges: ARENA_V2.bridges.map((b) => ({ ...b })),
        ford: { minX: ARENA_V2.riftFord.minX, maxX: ARENA_V2.riftFord.maxX },
        zones: { south: { minY: 0, maxY: 53 }, center: { minY: 54, maxY: 106 }, north: { minY: 107, maxY: 160 } },
        ownTerritory: seat === 0 ? { minY: 0, maxY: ARENA_V2.river.minY - 1 } : { minY: ARENA_V2.river.maxY + 1, maxY: ARENA_V2.maxY },
        deploy: { minX: ARENA_V2.minX + ARENA_V2.deployMarginX, maxX: ARENA_V2.maxX - ARENA_V2.deployMarginX, laneSplitX: ARENA_V2.laneSplitX, pocketDepth: ARENA_V2.pocketDepth },
      },
      durationTicks: COMBAT_TIMELINE_V1.durationTicks,
      overtimeTicks: COMBAT_TIMELINE_V1.overtimeTicks,
      ticksPerSecond: TICKS_PER_SECOND,
      // Filled in by the room, which owns resume tokens and the grace policy.
      resumeToken: "",
      resumed: false,
      reconnectGraceMs: 0,
    };
  }

  /**
   * Validate the intent shape and session rules, then queue it for the next
   * tick. Hand, energy, placement, commander and cooldown checks happen in
   * the engine, which emits command_rejected with the assigned seq.
   */
  submit(playerId: string, raw: unknown): AckMessage | null {
    const tick = this.state?.tick ?? 0;
    const parsed = clientCommandSchema.safeParse(raw);
    const cid = typeof (raw as { cid?: unknown })?.cid === "string" ? String((raw as { cid: string }).cid).slice(0, 40) : "";
    if (!parsed.success) return { cid, ok: false, reason: "Malformed command", tick };
    const seat = this.seatOf(playerId);
    if (seat === null || this.phase !== "active" || !this.state) return { cid, ok: false, reason: "Battle is not active", tick };
    const { cid: id, ...cmd } = parsed.data;
    if (this.cids[seat].has(id)) return { cid: id, ok: false, reason: "Duplicate command", tick };
    this.cids[seat].add(id);
    if (this.pending.filter((p) => p.seat === seat).length >= MAX_COMMANDS_PER_TICK) return { cid: id, ok: false, reason: "Too many commands this tick", tick };
    this.pending.push({ seat, cid: id, cmd });
    return null;
  }

  /**
   * One authoritative 100ms tick. Same-tick intents are ordered by a seat
   * priority that alternates with tick parity (arrival order inside a seat),
   * so network timing never gives one seat a permanent first-mover edge.
   */
  tick(): TickOutput | null {
    const state = this.state;
    if (this.phase !== "active" || !state) return null;
    const next = state.tick + 1;
    const first: PlayerIndex = next % 2 === 0 ? 0 : 1;
    const ordered = [...this.pending.filter((p) => p.seat === first), ...this.pending.filter((p) => p.seat !== first)];
    this.pending = [];
    const issued = ordered.map((p) => {
      const seq = this.nextSeq++;
      const cmd: CombatCommand =
        p.cmd.type === "deploy" ? { seq, player: p.seat, tick: next, cardId: p.cmd.cardId, x: p.cmd.x, y: p.cmd.y } : { kind: "ability", seq, player: p.seat, tick: next, abilityId: p.cmd.abilityId };
      return { p, cmd };
    });
    for (const { cmd } of issued) this.commands.push(cmd);
    stepMatch(state, issued.map((i) => i.cmd));
    const fresh = state.events.slice(this.eventCursor);
    this.eventCursor = state.events.length;
    const acks: [AckMessage[], AckMessage[]] = [[], []];
    for (const { p, cmd } of issued) {
      const rej = fresh.find((e) => e.type === "command_rejected" && e.seq === cmd.seq) as Extract<CombatEvent, { type: "command_rejected" }> | undefined;
      acks[p.seat].push({ cid: p.cid, ok: !rej, reason: rej?.reason ?? null, tick: next });
    }
    let end: TickOutput["end"] = null;
    if (state.phase === "final") end = this.finish();
    return { frames: [this.frame(0, fresh), this.frame(1, fresh)], acks, end };
  }

  private finish(): [EndMessage, EndMessage] {
    const state = this.state!;
    this.phase = "finished";
    const replay = runMatch(this.config!, this.commands);
    const liveHash = stateHash(state);
    const players = [this.slots[this.seatOfSlot.indexOf(0)]!, this.slots[this.seatOfSlot.indexOf(1)]!] as [SeatPlayer, SeatPlayer];
    const commanders = [this.loadouts[this.seatOfSlot.indexOf(0)]!.grant.identity, this.loadouts[this.seatOfSlot.indexOf(1)]!.grant.identity] as [CommanderIdentity, CommanderIdentity];
    const owners = [this.loadouts[this.seatOfSlot.indexOf(0)]!.grant.owner, this.loadouts[this.seatOfSlot.indexOf(1)]!.grant.owner] as [string | null, string | null];
    this.replay = { config: this.config!, commands: [...this.commands], players, liveHash, replayHash: replay.result.stateHash, replayIdentical: replay.result.stateHash === liveHash, winner: state.winner, endReason: state.endReason, ticks: state.tick, commanders, owners, patron: this.patron! };
    const msg = (seat: PlayerIndex): EndMessage => ({
      result: state.winner === "draw" || state.winner === null ? "draw" : state.winner === seat ? "win" : "loss",
      reason: state.endReason,
      crowns: [...state.crowns] as [number, number],
      ticks: state.tick,
      replayIdentical: this.replay!.replayIdentical,
      stateHash: liveHash,
      commands: this.commands.length,
      // Filled in by the room, which owns the durable match id.
      matchId: null,
    });
    return [msg(0), msg(1)];
  }

  /** Seat-filtered view: own hand/energy/abilities only, never seed or queues of the opponent. */
  frame(seat: PlayerIndex, fresh: CombatEvent[] = []): BattleFrame {
    const s = this.state!;
    const end = s.phase === "overtime" ? COMBAT_TIMELINE_V1.durationTicks + COMBAT_TIMELINE_V1.overtimeTicks : COMBAT_TIMELINE_V1.durationTicks;
    const chaos: ChaosView[] = [];
    s.chaos?.schedule.events.forEach((ev, i) => {
      if (!s.chaos!.warned[i] || s.chaos!.expired[i]) return;
      const zones = ev.effect.kind === "hazard" ? rankedChaosZones(ev.effect.zones).zones : ev.effect.kind === "zone" ? rankedChaosZones([ev.effect.crossing]).zones : [];
      chaos.push({ id: ev.id, family: ev.family, name: ev.displayName, state: s.chaos!.active[i] ? "active" : "warning", activationTick: Math.round(ev.activationMs / 100), expireTick: Math.round(ev.expireMs / 100), zones });
    });
    const shield = (u: { shieldHp: number; shieldUntil: number }) => (u.shieldUntil > s.tick ? u.shieldHp : 0);
    return {
      tick: s.tick,
      phase: s.phase,
      clockTicks: Math.max(0, end - s.tick),
      crowns: [...s.crowns] as [number, number],
      energy: s.energy[seat],
      energyProgress: s.energy[seat] >= ENERGY_V1.max ? 0 : s.energyProgress[seat] / (ENERGY_V1.regenTicksPerPoint * 100),
      regenMult: (energyPhaseMult(s.tick + 1) * (s.tick + 1 < s.energyModUntil ? s.energyModPct : 100)) / 100,
      hand: [...s.hands[seat]],
      next: s.queues[seat][0] ?? null,
      abilities: commanderAbilityStatus(s, seat).map((a) => ({ abilityId: a.abilityId, cost: a.cost, readyAt: a.readyAt, cooldownTicks: a.cooldownTicks, activeUntil: a.activeUntil, ready: a.ready, blockedBy: a.blockedBy })),
      troops: s.troops.filter((t) => t.hp > 0).map((t) => ({ id: t.id, owner: t.owner, cardId: t.cardId, x: t.x, y: t.y, hp: t.hp, maxHp: t.maxHp, air: t.moveType === "air", shield: shield(t) })),
      commanders: s.commanders.filter((c) => c.hp > 0).map((c) => ({ id: c.id, owner: c.owner, cardId: `cmdr:${c.commanderId}`, cls: c.class, x: c.x, y: c.y, hp: c.hp, maxHp: c.maxHp, air: false, shield: shield(c) })),
      structures: s.structures.map((x) => ({ id: x.id, owner: x.owner, kind: x.structure, x: x.x, y: x.y, hp: x.hp, maxHp: x.maxHp, alive: x.alive })),
      buildings: s.buildings.filter((b) => b.alive).map((b) => ({ id: b.id, owner: b.owner, cardId: b.cardId, x: b.x, y: b.y, hp: b.hp, maxHp: b.maxHp, footprint: b.footprint, expiresAt: b.expiresAt, ...(b.nextSpawnAt !== undefined ? { nextSpawnAt: b.nextSpawnAt, spawnsLeft: b.spawnsLeft ?? 0 } : {}) })),
      projectiles: s.projectiles.map((p) => ({ id: p.id, owner: p.owner, x: p.snapX, y: p.snapY, targetId: p.targetId })),
      impacts: s.pendingImpacts.map((i) => ({ id: i.id, owner: i.owner, cardId: i.cardId, x: i.x, y: i.y, impactTick: i.impactTick, ...(BUILDING_CARDS_V1[i.cardId]?.shell ? { radius: BUILDING_CARDS_V1[i.cardId]!.shell!.radius } : {}) })),
      chaos,
      riftOpen: s.tick < s.riftOpenUntil,
      events: fresh.filter((e) => PUBLIC_EVENTS.has(e.type) || (OWN_EVENTS.has(e.type) && "player" in e && e.player === seat)) as unknown as FrameEvent[],
    };
  }
}
