// Focused tests for the A4.2 commanders gallery model. These cover the five
// free classes, the Genesis read states, cached eligibility wording, selection
// resolution and the honest failure notices. No network or Privy here.

import { describe, it, expect } from "vitest";
import {
  buildGalleryClasses,
  classArtNote,
  defaultSelectionKey,
  eligibilityNotice,
  galleryEligibility,
  galleryProfileNotice,
  genesisFromError,
  genesisNote,
  parseGenesisCatalog,
  resolveGallerySelection,
  selectionChoice,
} from "./commanders-model";
import type { LobbyArt, LobbyCatalog, LobbyCatalogCommander, LobbyStat } from "./lobby-types";

const ART: LobbyArt = { src: "/class.png", width: 500, height: 700 };
const CARD_ART: LobbyArt = { src: "/card.png", width: 256, height: 256 };
const STATS: LobbyStat[] = [
  { label: "Deploy cost", value: "4" },
  { label: "Health", value: "290" },
];

function commander(
  classId: string,
  className: string,
  roleShort: string,
  cost: number,
  ability: string,
  counters: string[]
): LobbyCatalogCommander {
  return {
    classId,
    className,
    roleShort,
    role: `${roleShort} / authored role.`,
    cost,
    ability,
    counters,
    freeName: `${className} Recruit`,
    stats: STATS,
    art: ART,
    sprite: { src: `/sprite-${classId}.png`, width: 192, height: 256 },
    commanderCardArt: CARD_ART,
  };
}

const CATALOG: LobbyCatalog = {
  cards: {},
  commanders: [
    commander("bulwark", "Bulwark", "Tank", 5, "Aegis Wall", ["Reaver", "Scout"]),
    commander("reaver", "Reaver", "Bruiser", 5, "Frenzy Rush", ["Deadeye", "Warden"]),
    commander("deadeye", "Deadeye", "Ranged specialist", 5, "Piercing Volley", ["Bulwark", "Warden"]),
    commander("scout", "Scout", "Mobility", 4, "Shadow Step", ["Reaver", "Deadeye"]),
    commander("warden", "Warden", "Support", 5, "Null Field", ["Scout", "Bulwark"]),
  ],
};

describe("buildGalleryClasses", () => {
  it("maps exactly the five free classes from the live catalog", () => {
    const classes = buildGalleryClasses(CATALOG);
    expect(classes.map((c) => c.className)).toEqual(["Bulwark", "Reaver", "Deadeye", "Scout", "Warden"]);
    expect(classes.map((c) => c.key)).toEqual([
      "free:bulwark",
      "free:reaver",
      "free:deadeye",
      "free:scout",
      "free:warden",
    ]);
  });

  it("keeps the real cost, role, ability and counters", () => {
    const scout = buildGalleryClasses(CATALOG).find((c) => c.classId === "scout")!;
    expect(scout).toMatchObject({
      freeName: "Scout Recruit",
      cost: 4,
      roleShort: "Mobility",
      ability: "Shadow Step",
      counters: ["Reaver", "Deadeye"],
      stats: STATS,
      cardArt: CARD_ART,
    });
  });

  it("labels every class picture as shared class art", () => {
    const reaver = buildGalleryClasses(CATALOG).find((c) => c.classId === "reaver")!;
    expect(reaver.artNote).toBe(classArtNote("Reaver"));
    expect(reaver.artNote).toContain("not a specific NFT");
  });
});

describe("parseGenesisCatalog", () => {
  it("reports a malformed payload as unavailable rather than empty", () => {
    expect(parseGenesisCatalog(null, CATALOG)).toMatchObject({ state: "unavailable", entries: [] });
    expect(parseGenesisCatalog({}, CATALOG)).toMatchObject({ state: "unavailable", entries: [] });
    expect(parseGenesisCatalog({ nftCommanders: "nope" }, CATALOG)).toMatchObject({
      state: "unavailable",
      entries: [],
    });
  });

  it("reports no verified wallet separately from zero holdings", () => {
    const noWallet = parseGenesisCatalog({ nftCommanders: [], walletsChecked: 0, freshness: "cached" }, CATALOG);
    expect(noWallet.state).toBe("no-wallet");
    expect(noWallet.note).toContain("No verified wallet");

    const empty = parseGenesisCatalog({ nftCommanders: [], walletsChecked: 2, freshness: "cached" }, CATALOG);
    expect(empty.state).toBe("empty");
    expect(empty.note).toContain("No Chog Genesis commander");
  });

  it("keeps a derived eligible token and its class numbers", () => {
    const result = parseGenesisCatalog(
      {
        walletsChecked: 1,
        freshness: "cached",
        nftCommanders: [
          {
            tokenId: "1462",
            name: "CHOG #1462",
            status: "derived",
            eligible: true,
            commander: { class: "scout" },
            imageUrl: "https://gateway.example/1462.png",
          },
        ],
      },
      CATALOG
    );

    expect(result.state).toBe("ready");
    expect(result.entries).toEqual([
      expect.objectContaining({
        key: "nft:1462",
        tokenId: "1462",
        name: "CHOG #1462",
        className: "Scout",
        classId: "scout",
        eligible: true,
        cost: 4,
        stats: STATS,
        imageUrl: "https://gateway.example/1462.png",
        artNote: "Original token art.",
      }),
    ]);
    expect(result.note).toContain("Cached eligibility is not current ownership proof");
  });

  it("keeps an unproven or pending token but never marks it eligible", () => {
    const result = parseGenesisCatalog(
      {
        walletsChecked: 1,
        nftCommanders: [
          {
            tokenId: "77",
            name: null,
            status: "derived",
            eligible: false,
            reason: "No verified linked wallet holds this token right now.",
            commander: { class: "warden" },
          },
          { tokenId: "78", status: "pending", eligible: false, reason: "Metadata not resolved" },
        ],
      },
      CATALOG
    );

    expect(result.entries[0]).toMatchObject({
      name: "Chog Genesis #77",
      className: "Warden",
      eligible: false,
      reason: "No verified linked wallet holds this token right now.",
    });
    expect(result.entries[1]).toMatchObject({
      className: "Class unavailable",
      classId: null,
      eligible: false,
      status: "pending",
      cost: null,
      stats: [],
    });
    expect(result.note).toContain("Cached eligibility");
  });

  it("drops duplicates and malformed rows, and treats an all-malformed list as unavailable", () => {
    const deduped = parseGenesisCatalog(
      {
        walletsChecked: 1,
        nftCommanders: [
          { tokenId: "1", status: "derived", eligible: true, commander: { class: "scout" } },
          { tokenId: "1", status: "derived", eligible: true, commander: { class: "scout" } },
          { tokenId: "", status: "derived", eligible: true, commander: { class: "scout" } },
        ],
      },
      CATALOG
    );
    expect(deduped.entries).toHaveLength(1);

    const malformed = parseGenesisCatalog({ walletsChecked: 1, nftCommanders: [{}, null] }, CATALOG);
    expect(malformed.state).toBe("unavailable");
  });

  it("accepts only https token art and falls back to labelled class art", () => {
    const result = parseGenesisCatalog(
      {
        walletsChecked: 1,
        nftCommanders: [
          { tokenId: "2", status: "derived", eligible: true, commander: { class: "reaver" }, imageUrl: "http://bad" },
        ],
      },
      CATALOG
    );
    expect(result.entries[0]?.imageUrl).toBeNull();
    expect(result.entries[0]?.artNote).toContain("Shared Reaver class art");
  });

  it("never carries wallet addresses or unrelated payload fields", () => {
    const result = parseGenesisCatalog(
      {
        walletsChecked: 1,
        address: "0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF",
        privyDid: "did:privy:abc123",
        nftCommanders: [
          {
            tokenId: "3",
            status: "derived",
            eligible: true,
            commander: { class: "bulwark" },
            address: "0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF",
          },
        ],
      },
      CATALOG
    );
    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toContain("0xdeadbeef");
    expect(serialized).not.toContain("did:privy");
  });

  it("maps forbidden to locked and every other failure to unavailable", () => {
    expect(genesisFromError("FORBIDDEN").state).toBe("locked");
    expect(genesisFromError("INTERNAL_ERROR").state).toBe("unavailable");
    expect(genesisFromError("NETWORK").state).toBe("unavailable");
    expect(genesisNote("locked", null)).toContain("locked");
    expect(genesisNote("unavailable", null)).toContain("could not be read");
  });
});

describe("selection", () => {
  const classes = buildGalleryClasses(CATALOG);
  const genesis = parseGenesisCatalog(
    {
      walletsChecked: 1,
      nftCommanders: [{ tokenId: "1462", status: "derived", eligible: true, commander: { class: "scout" } }],
    },
    CATALOG
  );

  it("defaults to Reaver and resolves a free class selection", () => {
    expect(defaultSelectionKey(classes)).toBe("free:reaver");
    const selected = resolveGallerySelection("free:scout", classes, genesis);
    expect(selected).toMatchObject({ kind: "free", key: "free:scout" });
    expect(selected?.classItem?.className).toBe("Scout");
    expect(selected?.genesis).toBeNull();
  });

  it("resolves a Genesis selection by token key", () => {
    const selected = resolveGallerySelection("nft:1462", classes, genesis);
    expect(selected).toMatchObject({ kind: "nft", key: "nft:1462" });
    expect(selected?.genesis?.className).toBe("Scout");
    expect(selected?.classItem).toBeNull();
  });

  it("returns null for a key that is not in either list", () => {
    expect(resolveGallerySelection("free:nope", classes, genesis)).toBeNull();
    expect(resolveGallerySelection("nft:999", classes, genesis)).toBeNull();
    expect(resolveGallerySelection(null, classes, genesis)).toBeNull();
  });

  it("builds the claim shape the deck model already understands", () => {
    expect(selectionChoice(resolveGallerySelection("free:warden", classes, genesis))).toEqual({
      kind: "free",
      class: "warden",
    });
    expect(selectionChoice(resolveGallerySelection("nft:1462", classes, genesis))).toEqual({
      kind: "nft",
      tokenId: "1462",
    });
  });

  it("builds eligibility with no prestige or variant fields presented as rarity", () => {
    const eligibility = galleryEligibility(classes, genesis);
    expect(eligibility.free).toHaveLength(5);
    expect(eligibility.nft[0]).toMatchObject({
      tokenId: "1462",
      classId: "scout",
      eligible: true,
      prestige: null,
      variant: null,
    });
  });
});

describe("notices", () => {
  it("gives a bootstrappable profile 404 a setup action", () => {
    const notice = galleryProfileNotice({
      code: "NOT_FOUND",
      message: "Player not provisioned",
      bootstrap: true,
    });
    expect(notice.tone).toBe("warn");
    expect(notice.action).toEqual({ label: "Finish profile setup", href: "/app/onboarding" });
  });

  it("keeps session, lock and generic profile failures separate", () => {
    expect(galleryProfileNotice({ code: "UNAUTHORIZED", message: "Authentication required" }).text).toContain(
      "session is no longer valid"
    );
    expect(galleryProfileNotice({ code: "FORBIDDEN", message: "Account suspended" }).text).toContain(
      "Account suspended"
    );
    expect(galleryProfileNotice({ code: "INTERNAL_ERROR", message: "Database unavailable" }).text).toContain(
      "Database unavailable"
    );
  });

  it("only raises a top-level eligibility notice for auth and setup locks", () => {
    expect(eligibilityNotice({ code: "UNAUTHORIZED", message: "x" })?.tone).toBe("error");
    expect(eligibilityNotice({ code: "FORBIDDEN", message: "x" })?.tone).toBe("error");
    expect(eligibilityNotice({ code: "INTERNAL_ERROR", message: "x" })).toBeNull();
    expect(eligibilityNotice({ code: "NETWORK", message: "x" })).toBeNull();
  });
});
