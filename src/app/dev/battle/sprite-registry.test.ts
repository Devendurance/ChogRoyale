// B2.8d sprite registry tests. Reads the committed runtime manifest and
// verifies every bound engine id resolves, imported files exist on disk with
// matching sha256, and no card-derivative or NFT-portrait record slipped in.

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATEGORY_MULT,
  displayScale,
  effectForAbility,
  effectForRequirement,
  resolveCommanderAsset,
  resolveEntityAsset,
  type SpriteManifest,
} from "./sprite-registry";

const PUBLIC_ROOT = join(process.cwd(), "public");
const manifest = JSON.parse(
  readFileSync(join(PUBLIC_ROOT, "assets/chog-kit/v001/manifests/phaser-assets.runtime.json"), "utf8")
) as SpriteManifest;

describe("sprite registry", () => {
  it("resolves every bound engine id", () => {
    const troops = [
      "choglings",
      "chaos_archer",
      "boulderback",
      "frostshell",
      "rift_runner",
      "sparkcaster",
      "chog_guardian",
      "hexwing",
      "rift_sprites",
      "gale_netter",
      "riftbreaker",
      "ember_mauler",
      "burrow_scrapper",
    ];
    for (const id of troops) expect(resolveEntityAsset(manifest, "troop", id)?.stableAssetId).toBeTruthy();
    for (const id of ["rift_sentry", "decoy_totem", "chog_burrow", "rift_mortar"])
      expect(resolveEntityAsset(manifest, "building", id)?.stableAssetId).toBeTruthy();
    for (const id of ["chaos_bolt", "rally_horn", "chaos_comet", "rift_snare"])
      expect(resolveEntityAsset(manifest, "spell", id)?.stableAssetId).toBeTruthy();
    for (const id of ["tower", "core"]) expect(resolveEntityAsset(manifest, "structure", id)?.stableAssetId).toBeTruthy();
    for (const cls of ["bulwark", "reaver", "deadeye", "scout", "warden"])
      expect(resolveCommanderAsset(manifest, cls)?.stableAssetId).toBe(`commander:${cls}`);
  });

  it("returns null for unknown ids and resolves commanders by class only", () => {
    expect(resolveEntityAsset(manifest, "troop", "not_a_card")).toBeNull();
    expect(resolveEntityAsset(manifest, "building", "choglings")).toBeNull();
    expect(resolveCommanderAsset(manifest, "not_a_class")).toBeNull();
    // An NFT token id is never an asset key: only the class template resolves.
    expect(resolveCommanderAsset(manifest, "91250")).toBeNull();
  });

  it("excludes card art derivatives and NFT portraits", () => {
    for (const a of manifest.assets) {
      expect(a.category).not.toBe("card_art_derivative");
      expect(a.category).not.toBe("exact_nft_portrait");
    }
    expect(manifest.assets).toHaveLength(34);
  });

  it("imports files that exist and match their recorded sha256", () => {
    for (const a of manifest.assets) {
      const abs = join(PUBLIC_ROOT, "assets/chog-kit/v001", a.path);
      expect(existsSync(abs), a.stableAssetId).toBe(true);
      const sha = createHash("sha256").update(readFileSync(abs)).digest("hex");
      expect(sha, a.stableAssetId).toBe(a.sha256);
    }
  });

  it("orders rendered size small < regular < heavy and structure > troop", () => {
    // uniformScale is uniform for battle art; the size hierarchy lives in the
    // authored visible height, so compare rendered visible pixels.
    const visible = (kind: "troop" | "structure", id: string) => {
      const r = resolveEntityAsset(manifest, kind, id)!;
      return r.proposedDisplaySize.visibleHeight * displayScale(r);
    };
    expect(visible("troop", "choglings")).toBeLessThan(visible("troop", "chog_guardian"));
    expect(visible("troop", "chog_guardian")).toBeLessThan(visible("troop", "boulderback"));
    const tower = resolveEntityAsset(manifest, "structure", "tower")!;
    const guardian = resolveEntityAsset(manifest, "troop", "chog_guardian")!;
    expect(displayScale(tower)).toBeGreaterThan(displayScale(guardian));
    expect(visible("structure", "tower")).toBeGreaterThan(visible("troop", "chog_guardian"));
    expect(CATEGORY_MULT.commander_class_template).toBeGreaterThan(CATEGORY_MULT.troop);
  });

  it("binds spell impacts, abilities and chaos families to effect primitives", () => {
    for (const req of ["chaos_bolt_effect", "chaos_comet_effect", "rift_snare_effect", "rally_horn_effect", "rift_mortar_shell", "chog_burrow_spawn"])
      expect(effectForRequirement(manifest, req).length).toBeGreaterThan(0);
    for (const fam of ["ember_rift", "frost_crossing", "energy_surge", "rift_shift", "chaos_rally"])
      expect(effectForRequirement(manifest, fam).length).toBeGreaterThan(0);
    expect(effectForAbility(manifest, "scout-shadow-step").length).toBeGreaterThan(0);
    expect(effectForAbility(manifest, "warden-mend").length).toBeGreaterThan(0);
    expect(effectForRequirement(manifest, "nonexistent")).toEqual([]);
  });
});
