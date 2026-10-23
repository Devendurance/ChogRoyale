// Focused tests for the A4.1 settings model. These cover the rules the screen
// shows: the display-name guard, the avatar catalog, the address-free wallet
// summary, the read and save error copy. Nothing here talks to the network.

import { describe, it, expect } from "vitest";
import {
  DISPLAY_NAME_MAX,
  avatarChoiceById,
  avatarsNote,
  checkDisplayName,
  isNameChanged,
  parseAvatarCatalog,
  readStateForError,
  saveErrorMessage,
  saveStatusText,
  settingsNoticeFor,
  summarizeWallets,
  walletChainLabel,
  walletTypeLabel,
  walletsNote,
} from "./settings-model";

describe("checkDisplayName", () => {
  it("requires a non-empty trimmed name", () => {
    expect(checkDisplayName("")).toEqual({ ok: false, message: "Enter a display name." });
    expect(checkDisplayName("   ")).toEqual({ ok: false, message: "Enter a display name." });
  });

  it("trims the value before saving", () => {
    expect(checkDisplayName("  Endychog  ")).toEqual({ ok: true, value: "Endychog" });
  });

  it("accepts exactly the maximum length and rejects one more", () => {
    expect(checkDisplayName("a".repeat(DISPLAY_NAME_MAX))).toEqual({
      ok: true,
      value: "a".repeat(DISPLAY_NAME_MAX),
    });
    expect(checkDisplayName("a".repeat(DISPLAY_NAME_MAX + 1))).toEqual({
      ok: false,
      message: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.`,
    });
  });

  it("treats a trim-only change as no change", () => {
    expect(isNameChanged("  Endychog ", "Endychog")).toBe(false);
    expect(isNameChanged("Endychog", null)).toBe(true);
    expect(isNameChanged("Endychog", "Blossom")).toBe(true);
  });
});

describe("parseAvatarCatalog", () => {
  it("accepts the real catalog shape", () => {
    const catalog = parseAvatarCatalog({
      avatars: [{ id: "chog-1", name: "Chog One", assetUrl: "/avatars/chog-1.png" }],
    });
    expect(catalog.state).toBe("ready");
    expect(catalog.choices).toEqual([
      { id: "chog-1", name: "Chog One", assetUrl: "/avatars/chog-1.png" },
    ]);
  });

  it("reports a successful empty list as empty", () => {
    expect(parseAvatarCatalog({ avatars: [] })).toEqual({ state: "empty", choices: [] });
  });

  it("reports a malformed payload as unavailable", () => {
    expect(parseAvatarCatalog(null)).toEqual({ state: "unavailable", choices: [] });
    expect(parseAvatarCatalog({})).toEqual({ state: "unavailable", choices: [] });
    expect(parseAvatarCatalog({ avatars: "nope" })).toEqual({ state: "unavailable", choices: [] });
  });

  it("drops entries without a usable id, name or asset URL", () => {
    const catalog = parseAvatarCatalog({
      avatars: [
        { id: "", name: "No id", assetUrl: "/a.png" },
        { id: "no-name", name: "", assetUrl: "/b.png" },
        { id: "no-url", name: "No URL", assetUrl: "" },
        { id: "kept", name: "Kept", assetUrl: "/c.png" },
      ],
    });
    expect(catalog.state).toBe("ready");
    expect(catalog.choices.map((choice) => choice.id)).toEqual(["kept"]);
  });

  it("reports a payload with only malformed entries as unavailable", () => {
    expect(parseAvatarCatalog({ avatars: [{ id: "missing-fields" }] })).toEqual({
      state: "unavailable",
      choices: [],
    });
  });

  it("drops duplicate ids so the picker cannot render one twice", () => {
    const catalog = parseAvatarCatalog({
      avatars: [
        { id: "chog-1", name: "First", assetUrl: "/a.png" },
        { id: "chog-1", name: "Second", assetUrl: "/b.png" },
      ],
    });
    expect(catalog.choices).toEqual([{ id: "chog-1", name: "First", assetUrl: "/a.png" }]);
  });

  it("resolves membership by id and returns null for an unknown choice", () => {
    const choices = parseAvatarCatalog({
      avatars: [{ id: "chog-1", name: "Chog One", assetUrl: "/avatars/chog-1.png" }],
    }).choices;
    expect(avatarChoiceById(choices, "chog-1")?.name).toBe("Chog One");
    expect(avatarChoiceById(choices, "missing")).toBeNull();
    expect(avatarChoiceById(choices, null)).toBeNull();
  });
});

describe("summarizeWallets", () => {
  it("counts verified, primary and wallet types without any address", () => {
    const summary = summarizeWallets({
      wallets: [
        {
          id: "wallet-row-1",
          address: "0x1111111111111111111111111111111111111111",
          chainId: 143,
          walletType: "embedded",
          isPrimary: true,
          verifiedAt: "2026-10-20T10:00:00.000Z",
          linkSource: "privy",
        },
        {
          id: "wallet-row-2",
          address: "0x2222222222222222222222222222222222222222",
          chainId: 1,
          walletType: "external",
          isPrimary: false,
          verifiedAt: null,
          linkSource: "privy",
        },
      ],
    });

    expect(summary).toMatchObject({
      state: "ready",
      total: 2,
      verified: 1,
      primary: 1,
      embedded: 1,
      external: 1,
    });
    expect(summary.lines).toEqual([
      { key: "wallet-0", typeLabel: "Embedded wallet", chainLabel: "Monad", verified: true, primary: true },
      { key: "wallet-1", typeLabel: "External wallet", chainLabel: "Chain 1", verified: false, primary: false },
    ]);
  });

  it("drops addresses, row ids and Privy identifiers from the rendered summary", () => {
    const summary = summarizeWallets({
      wallets: [
        {
          id: "wallet-row-1",
          address: "0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF",
          chainId: 143,
          walletType: "embedded",
          isPrimary: true,
          verifiedAt: "2026-10-20T10:00:00.000Z",
          linkSource: "did:privy:cm123abc",
        },
      ],
    });

    const serialized = JSON.stringify(summary).toLowerCase();
    expect(serialized).not.toContain("0xdeadbeef");
    expect(serialized).not.toContain("wallet-row-1");
    expect(serialized).not.toContain("did:privy");
    expect(serialized).not.toContain("cm123abc");
  });

  it("reports a successful zero-wallet payload as empty", () => {
    expect(summarizeWallets({ wallets: [] })).toMatchObject({ state: "empty", total: 0 });
  });

  it("reports a malformed or failed read as unavailable", () => {
    expect(summarizeWallets(null)).toMatchObject({ state: "unavailable", total: 0 });
    expect(summarizeWallets({})).toMatchObject({ state: "unavailable", total: 0 });
    expect(summarizeWallets({ wallets: [{}, null] })).toMatchObject({ state: "unavailable", total: 0 });
  });

  it("labels only known chain and wallet values", () => {
    expect(walletChainLabel(143)).toBe("Monad");
    expect(walletChainLabel(8453)).toBe("Chain 8453");
    expect(walletChainLabel("143")).toBeNull();
    expect(walletTypeLabel("embedded")).toBe("Embedded wallet");
    expect(walletTypeLabel("external")).toBe("External wallet");
    expect(walletTypeLabel("smart")).toBe("Wallet");
  });
});

describe("read and error states", () => {
  it("maps a 403 to locked and every other read failure to unavailable", () => {
    expect(readStateForError("FORBIDDEN")).toBe("locked");
    expect(readStateForError("UNAUTHORIZED")).toBe("unavailable");
    expect(readStateForError("INTERNAL_ERROR")).toBe("unavailable");
    expect(readStateForError("NETWORK")).toBe("unavailable");
  });

  it("gives each read state its own copy", () => {
    expect(avatarsNote("ready")).toBeNull();
    expect(avatarsNote("empty")).toContain("picker is empty");
    expect(avatarsNote("locked")).toContain("locked");
    expect(avatarsNote("unavailable")).toContain("could not be read");
    expect(walletsNote("ready")).toBeNull();
    expect(walletsNote("empty")).toContain("No wallet");
    expect(walletsNote("locked")).toContain("locked");
    expect(walletsNote("unavailable")).toContain("could not be read");
  });

  it("turns a bootstrappable 404 into a setup action", () => {
    const notice = settingsNoticeFor({ code: "NOT_FOUND", message: "Player not provisioned", bootstrap: true });
    expect(notice.tone).toBe("warn");
    expect(notice.action).toEqual({ label: "Finish profile setup", href: "/dev/onboarding" });
  });

  it("keeps auth, setup lock and service failures honest", () => {
    expect(settingsNoticeFor({ code: "UNAUTHORIZED", message: "Authentication required" }).text).toContain(
      "session is no longer valid"
    );
    const locked = settingsNoticeFor({ code: "FORBIDDEN", message: "Setup is locked" });
    expect(locked.tone).toBe("error");
    expect(locked.text).toContain("Setup is locked");
    expect(settingsNoticeFor({ code: "INTERNAL_ERROR", message: "Database unavailable" }).text).toContain(
      "Database unavailable"
    );
  });
});

describe("save state copy", () => {
  it("names each save state exactly once", () => {
    expect(saveStatusText("saving", null, true)).toBe("Saving to your account.");
    expect(saveStatusText("saved", null, false)).toBe("Saved to your account.");
    expect(saveStatusText("error", "That name is taken.", true)).toBe("That name is taken.");
    expect(saveStatusText("error", null, true)).toBe("Your changes were not saved.");
    expect(saveStatusText("idle", null, true)).toBe("Unsaved changes stay on this screen until you save.");
    expect(saveStatusText("idle", null, false)).toBe("No changes to save.");
  });

  it("uses the server validation message for a rejected change", () => {
    expect(saveErrorMessage("BAD_REQUEST", "Unknown avatar selection")).toBe("Unknown avatar selection");
    expect(saveErrorMessage("UNPROCESSABLE", "")).toBe("The server rejected that change.");
  });

  it("never claims a save after an auth, lock or service failure", () => {
    expect(saveErrorMessage("UNAUTHORIZED", "Authentication required")).toContain("nothing was saved");
    expect(saveErrorMessage("FORBIDDEN", "Setup is locked")).toContain("cannot save changes");
    expect(saveErrorMessage("SERVICE_UNAVAILABLE", "Down")).toContain("nothing was saved");
    expect(saveErrorMessage("INTERNAL_ERROR", "Down")).toContain("nothing was saved");
    expect(saveErrorMessage("NETWORK", "Offline")).toContain("nothing was saved");
    expect(saveErrorMessage("REQUEST_FAILED", "Odd")).toContain("Your changes were not saved");
  });
});
