import { describe, expect, it } from "vitest";
import { chooseInitialLoadout, loadoutPutSchema, type SavedLoadout } from "@/lib/loadout";
import { validateSavedLoadout } from "@/server/loadout";
import { PRESETS } from "@/server/battle/session";
import { commanderCardId, freeStarterSlot } from "@/lib/combat";
import { CHOG_GENESIS_CHAIN_ID, CHOG_GENESIS_CONTRACT, type CommanderChoice } from "@/lib/battle-protocol";

const swarm = PRESETS["swarm"]!;
const freeScout: CommanderChoice = { kind: "free", class: "scout" };
const nft = (tokenId: string): CommanderChoice => ({ kind: "nft", chainId: CHOG_GENESIS_CHAIN_ID, contract: CHOG_GENESIS_CONTRACT, tokenId });

const saved = (cards: string[], commander: CommanderChoice, revision = 3): SavedLoadout => ({
  schemaVersion: 1,
  cards,
  commander,
  revision,
  updatedAt: new Date().toISOString(),
});

describe("chooseInitialLoadout", () => {
  const draft = { cards: [...PRESETS["siege"]!.cards], commander: { kind: "free", class: "warden" } as CommanderChoice };

  it("server copy always wins over a stale local draft", () => {
    const pick = chooseInitialLoadout({ server: saved(swarm.cards, freeScout), localDraft: draft, presets: PRESETS });
    expect(pick.source).toBe("server");
    expect(pick.cards).toEqual(swarm.cards);
    expect(pick.commander).toEqual(freeScout);
  });

  it("falls back to the local draft only when there is no server deck", () => {
    const pick = chooseInitialLoadout({ server: null, localDraft: draft, presets: PRESETS });
    expect(pick.source).toBe("local-draft");
    expect(pick.cards).toEqual(draft.cards);
  });

  it("uses the first preset when neither exists", () => {
    const pick = chooseInitialLoadout({ server: null, localDraft: null, presets: PRESETS });
    expect(pick.source).toBe("default");
    expect(pick.cards).toEqual(Object.values(PRESETS)[0]!.cards);
    expect(pick.commander).toEqual({ kind: "free", class: Object.values(PRESETS)[0]!.commanderClass });
  });

  it("ignores a server copy marked invalid", () => {
    const pick = chooseInitialLoadout({ server: saved(swarm.cards, freeScout), serverInvalid: true, localDraft: draft, presets: PRESETS });
    expect(pick.source).toBe("local-draft");
  });
});

describe("loadoutPutSchema", () => {
  it("accepts a strict body and rejects extra keys and other versions", () => {
    const ok = { schemaVersion: 1, cards: swarm.cards, commander: freeScout, expectedRevision: 2 };
    expect(loadoutPutSchema.safeParse(ok).success).toBe(true);
    expect(loadoutPutSchema.safeParse({ ...ok, playerId: "x" }).success).toBe(false);
    expect(loadoutPutSchema.safeParse({ ...ok, schemaVersion: 2 }).success).toBe(false);
    expect(loadoutPutSchema.safeParse({ ...ok, expectedRevision: 0 }).success).toBe(false);
  });
});

describe("validateSavedLoadout", () => {
  it("accepts a 7-card deck with a free commander", () => {
    expect(() => validateSavedLoadout(swarm.cards, freeScout)).not.toThrow();
  });

  it("accepts an NFT claim with canonical fields", () => {
    expect(() => validateSavedLoadout(swarm.cards, nft("1462"))).not.toThrow();
  });

  it("rejects wrong chain, wrong contract and non-canonical token ids", () => {
    expect(() => validateSavedLoadout(swarm.cards, { kind: "nft", chainId: 1, contract: CHOG_GENESIS_CONTRACT, tokenId: "5" })).toThrow(/chain 143/);
    expect(() =>
      validateSavedLoadout(swarm.cards, { kind: "nft", chainId: 143, contract: "0x0000000000000000000000000000000000000000", tokenId: "5" })
    ).toThrow(/contract/);
    expect(() => validateSavedLoadout(swarm.cards, nft("007"))).toThrow(/canonical/);
    expect(() => validateSavedLoadout(swarm.cards, nft("0"))).toThrow(/canonical/);
    // Mixed-case contract is normalized.
    expect(() => validateSavedLoadout(swarm.cards, { kind: "nft", chainId: 143, contract: CHOG_GENESIS_CONTRACT.toUpperCase().replace("0X", "0x"), tokenId: "5" })).not.toThrow();
  });

  it("rejects duplicate, unknown, miscounted and commander cards", () => {
    expect(() => validateSavedLoadout([...swarm.cards.slice(0, 6), swarm.cards[0]!], freeScout)).toThrow(/Duplicate/);
    expect(() => validateSavedLoadout([...swarm.cards.slice(0, 6), "not-a-card"], freeScout)).toThrow(/not playable/i);
    expect(() => validateSavedLoadout(swarm.cards.slice(0, 6), freeScout)).toThrow(/exactly 8/);
    const cmdr = commanderCardId(freeStarterSlot("warden").commanderId);
    expect(() => validateSavedLoadout([...swarm.cards.slice(0, 6), cmdr], freeScout)).toThrow(/Commander card|7 ordinary/);
  });
});
