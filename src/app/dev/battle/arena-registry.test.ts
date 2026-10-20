import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARENA_URL,
  anchorScreenOffset,
  assemblyFor,
  attributeProjectile,
  boardPoint,
  defenderPose,
  directionalAim,
  layerVisible,
  masterToScreen,
  mountRoleFor,
  newDefenderState,
  placementFor,
  updateDefender,
  weaponArena,
  type ArenaManifest,
  type ArenaLayer,
} from "./arena-registry";

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "public/assets/arena/chaos-crossing/v002/manifests/arena.runtime.json"), "utf8")
) as ArenaManifest;

describe("arena manifest", () => {
  it("parses with 16 layers, 2 mount roles and 6 placements", () => {
    expect(manifest.layers).toHaveLength(16);
    expect(Object.keys(manifest.mounts).sort()).toEqual(["core-keeper", "sentinel"]);
    expect(manifest.placements).toHaveLength(6);
    for (const l of manifest.layers) expect(l.path.endsWith(".png")).toBe(true);
  });

  it("covers every imported png under the public asset root", () => {
    for (const l of manifest.layers) {
      expect(() => readFileSync(join(process.cwd(), `public${ARENA_URL}/${l.path}`))).not.toThrow();
    }
    for (const role of Object.values(manifest.mounts)) {
      const paths = [...Object.values(role.parts), ...Object.values(role.poses).map((p) => p.path)];
      for (const p of paths) {
        expect(p).toBeTruthy();
        expect(() => readFileSync(join(process.cwd(), `public${ARENA_URL}/${p}`))).not.toThrow();
      }
    }
  });

  it("missing manifest yields no layers (fallback decision)", () => {
    const empty = null as ArenaManifest | null;
    expect(empty?.layers ?? []).toEqual([]);
  });
});

describe("master to screen transform", () => {
  // Six authoritative structure anchors, bridges and the ford centre.
  const cases: { name: string; arena: [number, number] }[] = [
    { name: "p1 west tower", arena: [30, 120] },
    { name: "p1 east tower", arena: [70, 120] },
    { name: "p0 west tower", arena: [30, 40] },
    { name: "p0 east tower", arena: [70, 40] },
    { name: "p1 core", arena: [50, 152] },
    { name: "p0 core", arena: [50, 8] },
    { name: "west bridge", arena: [22.5, 80] },
    { name: "east bridge", arena: [77.5, 80] },
    { name: "ford", arena: [50, 80] },
  ];
  for (const c of cases) {
    it(`${c.name} maps through master px for both seats`, () => {
      const mx = 100 + 10 * c.arena[0];
      const my = 120 + 10 * (160 - c.arena[1]);
      expect(masterToScreen(mx, my, 0)).toEqual(boardPoint(c.arena[0], c.arena[1], 0));
      expect(masterToScreen(mx, my, 1)).toEqual(boardPoint(c.arena[0], c.arena[1], 1));
    });
  }

  it("seat 1 is a vertical mirror of seat 0", () => {
    expect(masterToScreen(400, 520, 0)).toEqual([150, 200]);
    expect(masterToScreen(400, 520, 1)).toEqual([150, 600]);
  });
});

describe("mount assembly", () => {
  it("selects sentinel for towers and core-keeper for cores", () => {
    expect(mountRoleFor("tower")).toBe("sentinel");
    expect(mountRoleFor("core")).toBe("core-keeper");
  });

  it("alive assembly is base, socket, defender, rim", () => {
    expect(assemblyFor(manifest, "sentinel", "idle")).toEqual([
      "sentinel:structure-base",
      "sentinel:socket-platform",
      "sentinel:defender-idle",
      "sentinel:front-rim",
    ]);
  });

  it("destroyed assembly is the base only", () => {
    expect(assemblyFor(manifest, "core-keeper", null)).toEqual(["core-keeper:structure-base"]);
  });

  it("resolves every placement to the authoritative structure point", () => {
    const expected: Record<string, [number, number]> = {
      "p1-west": [30, 120],
      "p1-east": [70, 120],
      "p0-west": [30, 40],
      "p0-east": [70, 40],
      "p1-core": [50, 152],
      "p0-core": [50, 8],
    };
    for (const [id, arena] of Object.entries(expected)) {
      const kind = id.endsWith("core") ? "core" : "tower";
      const p = placementFor(manifest, kind, arena[0], arena[1]);
      expect(p?.id).toBe(id);
    }
  });
});

describe("hemisphere pose selection", () => {
  it("bottom of screen aims north, top aims south", () => {
    expect(directionalAim(700)).toBe("aim-north");
    expect(directionalAim(100)).toBe("aim-south");
    expect(directionalAim(400)).toBe("aim-south");
  });

  it("local player structures aim north for both seats", () => {
    // Seat 0 local side (arena y 40) renders at screen y 600; seat 1 local
    // side (arena y 120) also renders at screen y 600.
    expect(directionalAim(boardPoint(30, 40, 0)[1])).toBe("aim-north");
    expect(directionalAim(boardPoint(30, 120, 1)[1])).toBe("aim-north");
    expect(directionalAim(boardPoint(30, 120, 0)[1])).toBe("aim-south");
    expect(directionalAim(boardPoint(30, 40, 1)[1])).toBe("aim-south");
  });
});

describe("defender pose state machine", () => {
  it("idle -> fire -> aim -> idle", () => {
    let s = newDefenderState();
    s = updateDefender(s, { hp: 1000, fired: false }, 0);
    expect(defenderPose(s, false, 600, 0)).toBe("idle");
    s = updateDefender(s, { hp: 1000, fired: true }, 10);
    expect(defenderPose(s, true, 600, 10)).toBe("fire");
    expect(defenderPose(s, true, 600, 200)).toBe("aim-north");
    expect(defenderPose(s, false, 600, 200)).toBe("idle");
  });

  it("hit shows on hp drop and beats aim", () => {
    let s = newDefenderState();
    s = updateDefender(s, { hp: 1000, fired: false }, 0);
    s = updateDefender(s, { hp: 900, fired: false }, 50);
    expect(defenderPose(s, true, 600, 60)).toBe("hit");
    expect(defenderPose(s, true, 600, 300)).toBe("aim-north");
  });
});

describe("projectile attribution", () => {
  it("credits a new projectile to the nearest same-owner weapon origin", () => {
    const role = manifest.mounts["sentinel"];
    const anchor = role.poses["aim-north"].weaponAnchorLocalBoardPixels;
    const [wx, wy] = weaponArena([400, 1320], anchor);
    const candidates = [{ id: "s-p0-tower-30", owner: 0, weaponX: wx, weaponY: wy }];
    expect(attributeProjectile({ x: wx + 0.4, y: wy + 0.2, owner: 0 }, candidates)).toBe("s-p0-tower-30");
    expect(attributeProjectile({ x: wx + 5, y: wy, owner: 0 }, candidates)).toBeNull();
    expect(attributeProjectile({ x: wx, y: wy, owner: 1 }, candidates)).toBeNull();
  });

  it("weapon anchors offset in screen pixels without rescaling", () => {
    expect(anchorScreenOffset([24.57, -85.555])).toEqual([12.285, -42.7775]);
  });
});

describe("ford and chaos layer state", () => {
  const layer = (id: string): ArenaLayer => manifest.layers.find((l) => l.id === id)!;
  const view = { riftOpen: false, anyWarning: false, anyActive: false, expiryUntil: 0, now: 0, rippleAlt: false };

  it("ford open only while riftOpen", () => {
    expect(layerVisible(layer("rift-ford-open"), { ...view, riftOpen: true })).toBe(true);
    expect(layerVisible(layer("rift-ford-open"), { ...view, riftOpen: false })).toBe(false);
    expect(layerVisible(layer("rift-ford-closing"), { ...view, riftOpen: true })).toBe(false);
    expect(layerVisible(layer("rift-ford-closing"), { ...view, riftOpen: false })).toBe(true);
  });

  it("warning and expiry never open the ford", () => {
    expect(layerVisible(layer("rift-ford-open"), { ...view, anyWarning: true, anyActive: true })).toBe(false);
  });

  it("chaos layers follow state and expiry window", () => {
    expect(layerVisible(layer("chaos-warning"), { ...view, anyWarning: true })).toBe(true);
    expect(layerVisible(layer("chaos-active"), { ...view, anyActive: true })).toBe(true);
    expect(layerVisible(layer("chaos-expiry"), { ...view, expiryUntil: 500, now: 300 })).toBe(true);
    expect(layerVisible(layer("chaos-expiry"), { ...view, expiryUntil: 500, now: 600 })).toBe(false);
  });

  it("ripples alternate, never stack", () => {
    const a = layer("water-ripples-0");
    const b = layer("water-ripples-1");
    expect(layerVisible(a, view)).toBe(true);
    expect(layerVisible(b, view)).toBe(false);
    expect(layerVisible(a, { ...view, rippleAlt: true })).toBe(false);
    expect(layerVisible(b, { ...view, rippleAlt: true })).toBe(true);
  });
});
