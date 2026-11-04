// Battle socket ownership. Exactly one room may drive the panel. A room's
// close arrives a network round trip after leave(), by which time the panel
// can already be in a new queue, room or match, so every callback must prove
// its room still owns the session. Without this, the finished match's close
// handler overwrites the next session's stage with "closed" or "reconnecting".

interface Leavable {
  leave(consented?: boolean): Promise<unknown>;
}

interface RoomEvents {
  onMessage(type: string, handler: (message: unknown) => void): unknown;
  onLeave(handler: (code: number) => void): unknown;
}

export interface RoomOwner<T> {
  claim(room: T): void;
  owns(room: T): boolean;
  /** Release one room, or whichever room is current when none is given. */
  release(room?: T): void;
}

export function createRoomOwner<T>(): RoomOwner<T> {
  let current: T | null = null;
  return {
    claim: (room) => {
      current = room;
    },
    owns: (room) => current === room,
    release: (room) => {
      if (room === undefined || current === room) current = null;
    },
  };
}

/**
 * Claim a room and return listeners that fire only while it stays current.
 * `always` runs on every close, for cleanup that belongs to the room itself.
 */
export function attachOwnedRoom<T extends RoomEvents>(room: T, owner: RoomOwner<T>) {
  owner.claim(room);
  return {
    on: <M,>(type: string, handler: (message: M) => void) => {
      room.onMessage(type, (message) => {
        if (owner.owns(room)) handler(message as M);
      });
    },
    onClose: (handler: (code: number) => void, always?: () => void) => {
      room.onLeave((code) => {
        always?.();
        if (!owner.owns(room)) return;
        owner.release(room);
        handler(code);
      });
    },
  };
}

const leaving = new WeakSet<object>();

/** Leave at most once and never surface a failure from an already dead socket. */
export function leaveRoom(room: Leavable | null | undefined): void {
  if (!room || leaving.has(room)) return;
  leaving.add(room);
  void Promise.resolve()
    .then(() => room.leave())
    .catch(() => {});
}
