import { describe, expect, it } from "vitest";
import { battleAssetPlan, KIT_URL, type BattleManifests } from "./battle-preload";

const manifests = {
  kit: {
    assets: [
      { stableAssetId: "troop:choglings", category: "troop", path: "troops/choglings/sprite.png" },
      { stableAssetId: "card:choglings", category: "card_art_derivative", path: "cards/choglings/portrait.png" },
    ],
  },
  arena: {
    base: "/assets/arena/chaos-crossing/v003",
    arena: {
      layers: [{ id: "background", path: "layers/background.webp" }],
      world: { path: "layers/world.webp", softPath: "layers/world-soft.webp", replaces: "base-terrain" },
      mounts: { friendly: { parts: { tower: "mounts/tower.png" }, poses: { aim: { path: "mounts/aim.png" } } } },
    },
  },
  units: {
    units: { choglings: { entityId: "choglings", sheet: "choglings/sheet.webp", frameWidth: 99, frameHeight: 99 } },
  },
  vfx: {
    textures: {
      burst: { kind: "sheet", path: "burst.webp", frameWidth: 64, frameHeight: 64 },
      spark: { kind: "image", path: "spark.webp" },
    },
  },
} as unknown as BattleManifests;

describe("battle asset plan", () => {
  it("lists renderer textures in the same manifests the scene uses", () => {
    const plan = battleAssetPlan(manifests, false);
    expect(plan).toContainEqual({ kind: "image", key: "troop:choglings", url: `${KIT_URL}/troops/choglings/sprite.png` });
    expect(plan).toContainEqual({
      kind: "sheet",
      key: "unit:choglings",
      url: "/assets/chog-units/v001/choglings/sheet.webp",
      frameWidth: 99,
      frameHeight: 99,
    });
    expect(plan).toContainEqual({ kind: "image", key: "arena:world", url: "/assets/arena/chaos-crossing/v003/layers/world.webp" });
    expect(plan).toContainEqual({ kind: "image", key: "arena:layer:background", url: "/assets/arena/chaos-crossing/v003/layers/background.webp" });
    expect(plan).toContainEqual({ kind: "sheet", key: "vfx:burst", url: "/assets/battle-vfx/v001/burst.webp", frameWidth: 64, frameHeight: 64 });
    expect(plan).toContainEqual({ kind: "image", key: "vfx:spark", url: "/assets/battle-vfx/v001/spark.webp" });
  });

  it("picks the soft world variant only when the viewport asks for it", () => {
    const hard = battleAssetPlan(manifests, false).find((a) => a.key === "arena:world");
    const soft = battleAssetPlan(manifests, true).find((a) => a.key === "arena:world");
    expect(hard).toMatchObject({ url: "/assets/arena/chaos-crossing/v003/layers/world.webp" });
    expect(soft).toMatchObject({ url: "/assets/arena/chaos-crossing/v003/layers/world-soft.webp" });
  });

  it("leaves DOM-only card portraits out of the renderer", () => {
    const all = battleAssetPlan(manifests, false);
    const renderer = battleAssetPlan(manifests, false, { cardArt: false });
    expect(all.some((a) => a.key === "card:choglings")).toBe(true);
    expect(renderer.some((a) => a.key === "card:choglings")).toBe(false);
    expect(renderer.some((a) => a.key === "troop:choglings")).toBe(true);
  });
});
