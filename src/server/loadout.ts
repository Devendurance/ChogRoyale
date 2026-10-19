// Server-only loadout validation. Uses the authoritative combat card tables,
// which pull in server deps (errors -> next/server), so this module must never
// be imported by client code.

import { AppError } from "@/lib/errors";
import { commanderCardId, freeStarterSlot, validateDeck } from "@/lib/combat";
import { CHOG_GENESIS_CHAIN_ID, CHOG_GENESIS_CONTRACT, type CommanderChoice } from "@/lib/battle-protocol";

/**
 * Validates a saved-loadout selection: 7 distinct ordinary cards plus a legal
 * commander claim. For an NFT claim only the chain/contract/token id are
 * checked here (the claim is resolved into a real commander slot by the battle
 * server at ready and again at match start); the ordinary cards are deck-
 * checked against a free starter slot of a fixed class, which only constrains
 * the ordinary-card set.
 */
export function validateSavedLoadout(cards: string[], commander: CommanderChoice): void {
  let cls: "bulwark" | "reaver" | "deadeye" | "scout" | "warden";
  if (commander.kind === "free") {
    cls = commander.class;
  } else {
    if (commander.chainId !== CHOG_GENESIS_CHAIN_ID) {
      throw new AppError("BAD_REQUEST", "NFT commander must be a Chog Genesis token on chain 143");
    }
    if (commander.contract.toLowerCase() !== CHOG_GENESIS_CONTRACT) {
      throw new AppError("BAD_REQUEST", "NFT commander must use the Chog Genesis contract");
    }
    if (!/^[1-9]\d{0,77}$/.test(commander.tokenId)) {
      throw new AppError("BAD_REQUEST", "NFT token id must be a canonical integer without leading zeros");
    }
    cls = "scout";
  }
  const slot = freeStarterSlot(cls);
  validateDeck([...cards, commanderCardId(slot.commanderId)], slot);
}
