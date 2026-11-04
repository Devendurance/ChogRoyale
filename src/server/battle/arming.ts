// Fair match start. A room starts its session as soon as loadouts lock, but
// the simulation stays frozen at tick 0 until every human seat reports a
// painted battlefield or the deadline expires. The deadline is what makes the
// wait safe: a client can only delay the first tick, once, and never past it.
// An expired wait aborts with no result rather than starting a match that a
// player cannot see. Readiness is per seat, so a drop clears only that seat.

/** Long enough for a cold 20 MB asset load on a slow mobile connection. */
export const MATCH_ARMING_MS = 60_000;

export interface ArmingClock {
  setTimeout(fn: () => void, ms: number): { clear(): void };
}

export interface ArmingHandlers {
  /** Every required seat is ready. Fires once. */
  onGo: () => void;
  /** The deadline passed with `waiting` seats still not ready. Fires once. */
  onExpired: (waiting: number[]) => void;
}

export class MatchArming {
  private readonly ready = new Set<number>();
  private readonly timer: { clear(): void };
  private settled = false;
  private readonly deadlineAt: number;

  constructor(
    private readonly slots: readonly number[],
    timeoutMs: number,
    clock: ArmingClock,
    private readonly handlers: ArmingHandlers,
    private readonly now: () => number = Date.now,
  ) {
    this.deadlineAt = now() + timeoutMs;
    this.timer = clock.setTimeout(() => this.expire(), timeoutMs);
  }

  get active(): boolean {
    return !this.settled;
  }

  /** Remaining wait for a late (resumed) client. Never negative. */
  get remainingMs(): number {
    return Math.max(0, this.deadlineAt - this.now());
  }

  isReady(slot: number): boolean {
    return this.ready.has(slot);
  }

  /** Idempotent. Returns true only when this call changed the seat's state. */
  markReady(slot: number): boolean {
    if (this.settled || !this.slots.includes(slot) || this.ready.has(slot)) return false;
    this.ready.add(slot);
    if (this.slots.every((s) => this.ready.has(s))) {
      this.settle();
      this.handlers.onGo();
    }
    return true;
  }

  /** A dropped seat must prove a painted battlefield again after it returns. */
  clear(slot: number): void {
    if (!this.settled) this.ready.delete(slot);
  }

  /** The match aborted for another reason. Fires neither handler. */
  cancel(): void {
    this.settle();
  }

  private expire(): void {
    if (this.settled) return;
    this.settle();
    this.handlers.onExpired(this.slots.filter((s) => !this.ready.has(s)));
  }

  private settle(): void {
    this.settled = true;
    this.timer.clear();
  }
}
