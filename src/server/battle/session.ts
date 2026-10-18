// B3.1 authoritative battle session. Transport-free so it is unit-testable;
// the Colyseus room is a thin adapter around it. All combat runs through the
// existing engine (initMatch/stepMatch, replayed with runMatch). Nothing here
// computes damage, energy, targeting or outcomes.

import { randomBytes, randomInt } from "crypto";
import { scenarioConfig } from "@/lib/arena-scenarios";
import { DECKS_V13 } from "@/lib/bot-economy";
import { FAIRNESS_PATRONS, fairnessSchedule } from "@/lib/chaos-fairness";
import {
  ARENA_V2,
  ARENA_VERSION,
  BUILDING_CARDS_V1,
  COMBAT_RULESET_VERSION,
  COMBAT_TIMELINE_V1,
  COMMANDER_COMBAT_PROFILE_V1,
  ENERGY_V1,
  SPELL_CARDS_V1,
  TICKS_PER_SECOND,
  TROOP_CARDS_V1,
  commanderAbilityStatus,
  energyPhaseMult,
  initMatch,
  rankedChaosZones,
  runMatch,
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
  type EndMessage,
  type FrameEvent,
  type LobbyMessage,
  type SessionPhase,
  type StartMessage,
} from "@/lib/battle-protocol";

/** Server-approved B3.1 decks: free commanders only, no NFT entitlement claims. */
export const APPROVED_DECKS: Record<string, string[]> = DECKS_V13;
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
]);
const OWN_EVENTS = new Set(["command_rejected", "ability_ready"]);

export function cardCatalog(): Record<string, CardInfo> {
  const out: Record<string, CardInfo> = {};
  for (const t of Object.values(TROOP_CARDS_V1)) out[t.id] = { id: t.id, name: t.name, cost: t.cost, kind: "troop", air: t.moveType === "air", radius: 0 };
  for (const s of Object.values(SPELL_CARDS_V1)) out[s.id] = { id: s.id, name: s.name, cost: s.cost, kind: "spell", air: false, radius: s.radius };
  for (const b of Object.values(BUILDING_CARDS_V1)) out[b.id] = { id: b.id, name: b.name, cost: b.cost, kind: "building", air: false, radius: b.footprint };
  for (const [cls, p] of Object.entries(COMMANDER_COMBAT_PROFILE_V1)) {
    const id = `cmdr:free-${cls}`;
    out[id] = { id, name: `${cls[0]!.toUpperCase()}${cls.slice(1)} Commander`, cost: p.cost, kind: "commander", air: false, radius: 0 };
  }
  return out;
}

export class BattleSession {
  phase: SessionPhase = "waiting";
  /** Join order slots; seats are assigned by the server at start. */
  readonly slots: Array<SeatPlayer | null> = [null, null];
  readonly ready: Array<string | null> = [null, null];
  /** slot -> seat, set at start. */
  seatOfSlot: [PlayerIndex, PlayerIndex] = [0, 1];
  config: CombatConfig | null = null;
  state: CombatState | null = null;
  readonly commands: CombatCommand[] = [];
  replay: ReplayRecord | null = null;
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
      this.ready[slot] = null;
    } else if (this.phase === "active") {
      this.phase = "aborted";
      this.abortReason = "Opponent disconnected. No result recorded (reconnect is a later B3 slice).";
    }
  }

  setReady(playerId: string, deck: string): boolean {
    const slot = this.slotOf(playerId);
    if (slot < 0 || this.phase !== "waiting") throw new Error("Not waiting for this player");
    if (!APPROVED_DECKS[deck]) throw new Error("Unknown deck");
    this.ready[slot] = deck;
    if (this.slots.every((p) => p !== null) && this.ready.every((d) => d !== null)) {
      this.start();
      return true;
    }
    return false;
  }

  lobby(slot: number): LobbyMessage {
    return { phase: this.phase, you: slot, players: this.slots.map((p, i) => ({ username: p?.username ?? "", ready: this.ready[i] !== null, deck: this.ready[i] ?? null })), decks: APPROVED_DECKS };
  }

  private start(): void {
    // Server-controlled seats, seed and Chaos patron. The seed never leaves the server.
    this.seatOfSlot = this.rng.int(2) === 0 ? [0, 1] : [1, 0];
    const seed = this.rng.seed();
    const patrons = Object.keys(FAIRNESS_PATRONS);
    const schedule = fairnessSchedule(patrons[this.rng.int(patrons.length)]!, seed);
    const deckOf = (seat: PlayerIndex) => APPROVED_DECKS[this.ready[this.seatOfSlot.indexOf(seat)]!]!;
    this.config = scenarioConfig(deckOf(0), deckOf(1), schedule, seed);
    this.state = initMatch(this.config);
    this.phase = "active";
  }

  startMessage(slot: number): StartMessage {
    const seat = this.seatOfSlot[slot]!;
    const opp = this.slots[this.seatOfSlot.indexOf((1 - seat) as PlayerIndex)]!;
    return {
      protocol: BATTLE_PROTOCOL_VERSION,
      ruleset: COMBAT_RULESET_VERSION,
      arena: ARENA_VERSION,
      seat,
      opponent: opp.username,
      deck: [...this.config!.decks[seat]],
      catalog: cardCatalog(),
      geometry: {
        width: ARENA_V2.maxX,
        height: ARENA_V2.maxY,
        river: { ...ARENA_V2.river },
        bridges: ARENA_V2.bridges.map((b) => ({ ...b })),
        ford: { minX: ARENA_V2.riftFord.minX, maxX: ARENA_V2.riftFord.maxX },
        zones: { south: { minY: 0, maxY: 53 }, center: { minY: 54, maxY: 106 }, north: { minY: 107, maxY: 160 } },
        ownTerritory: seat === 0 ? { minY: 0, maxY: ARENA_V2.river.minY - 1 } : { minY: ARENA_V2.river.maxY + 1, maxY: ARENA_V2.maxY },
      },
      durationTicks: COMBAT_TIMELINE_V1.durationTicks,
      overtimeTicks: COMBAT_TIMELINE_V1.overtimeTicks,
      ticksPerSecond: TICKS_PER_SECOND,
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
    this.replay = { config: this.config!, commands: [...this.commands], players, liveHash, replayHash: replay.result.stateHash, replayIdentical: replay.result.stateHash === liveHash, winner: state.winner, endReason: state.endReason, ticks: state.tick };
    const msg = (seat: PlayerIndex): EndMessage => ({
      result: state.winner === "draw" || state.winner === null ? "draw" : state.winner === seat ? "win" : "loss",
      reason: state.endReason,
      crowns: [...state.crowns] as [number, number],
      ticks: state.tick,
      replayIdentical: this.replay!.replayIdentical,
      stateHash: liveHash,
      commands: this.commands.length,
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
      buildings: s.buildings.filter((b) => b.alive).map((b) => ({ id: b.id, owner: b.owner, cardId: b.cardId, x: b.x, y: b.y, hp: b.hp, maxHp: b.maxHp, footprint: b.footprint, expiresAt: b.expiresAt })),
      projectiles: s.projectiles.map((p) => ({ id: p.id, owner: p.owner, x: p.snapX, y: p.snapY, targetId: p.targetId })),
      impacts: s.pendingImpacts.map((i) => ({ id: i.id, owner: i.owner, cardId: i.cardId, x: i.x, y: i.y, impactTick: i.impactTick })),
      chaos,
      riftOpen: s.tick < s.riftOpenUntil,
      events: fresh.filter((e) => PUBLIC_EVENTS.has(e.type) || (OWN_EVENTS.has(e.type) && "player" in e && e.player === seat)) as unknown as FrameEvent[],
    };
  }
}
