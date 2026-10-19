// Shared test fixtures for the battle suite. Not a test file.
import { freeStarterSlot, commanderCardId } from "@/lib/combat";
import type { CommanderClass } from "@/lib/commanders";
import type { CommanderGrant } from "@/server/battle/entitlement";
import type { TrustedLoadout } from "@/server/battle/session";

const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

export function freeGrant(cls: CommanderClass): CommanderGrant {
  const slot = freeStarterSlot(cls);
  return {
    slot,
    identity: {
      kind: "free",
      commanderId: slot.commanderId,
      cardId: commanderCardId(slot.commanderId),
      class: cls,
      variant: "free",
      prestige: "Free",
      name: `${cap(cls)} Commander`,
      tokenId: null,
      imageOriginal: null,
      rulesetVersion: "v1",
      derivationHash: slot.definition.derivationHash,
      basis: "free",
      verifiedAt: null,
    },
    owner: null,
  };
}

export function makeLoadout(cards: string[], cls: CommanderClass = "scout"): TrustedLoadout {
  return { cards, grant: freeGrant(cls) };
}
