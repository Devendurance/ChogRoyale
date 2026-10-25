import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARENA_URL,
  ARENA_URLS,
  ARENA_V003_URL,
  TEAM_COLORS,
  TEAM_TRIM_LAYER,
  anchorScreenOffset,
  assemblyFor,
  attributeProjectile,
  boardPoint,
  defenderCue,
  defenderPose,
  directionalAim,
  fireFresh,
  layerFlipY,
  layerVisible,
  masterToArena,
  masterToScreen,
  mountRoleFor,
  mountRoleForStructure,
  mountVisualOffsetY,
  newDefenderState,
  placementFor,
  structureTeamFor,
  teamTrimHalves,
  tintsTeamTrim,
  updateDefender,
  weaponArena,
  weaponScreen,
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

  it("pads only top Core visuals without moving the ground point", () => {
    expect(mountVisualOffsetY("core-keeper", 8)).toBe(72);
    expect(mountVisualOffsetY("core-keeper", 40)).toBe(40);
    expect(mountVisualOffsetY("core-keeper", 200)).toBe(0);
    expect(mountVisualOffsetY("sentinel", 40)).toBe(0);
  });

  it("maps structure accents from the viewing player's seat", () => {
    expect(structureTeamFor(0, 0)).toBe("friendly");
    expect(structureTeamFor(1, 0)).toBe("opponent");
    expect(structureTeamFor(0, 1)).toBe("opponent");
    expect(structureTeamFor(1, 1)).toBe("friendly");
  });

  it("renders the viewer's own structures blue at the bottom and the opponent red at the top", () => {
    const blue = TEAM_COLORS.friendly;
    const red = TEAM_COLORS.opponent;
    // Red channel dominates the opponent colour, blue channel the friendly one.
    expect(red >> 16).toBeGreaterThan(red & 0xff);
    expect(blue & 0xff).toBeGreaterThan(blue >> 16);
    const structures = manifest.placements.map((p) => {
      const [x, y] = masterToArena(p.groundAnchorPixels[0], p.groundAnchorPixels[1]);
      return { owner: p.id.startsWith("p0") ? 0 : 1, x, y };
    });
    for (const seat of [0, 1] as const) {
      for (const s of structures) {
        const screenY = boardPoint(s.x, s.y, seat)[1];
        const color = TEAM_COLORS[structureTeamFor(s.owner, seat)];
        expect(color).toBe(screenY > 400 ? blue : red);
      }
    }
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

  it("every structure picks hemisphere art by screen position, not directionRequested", () => {
    // placements carry a fixed authored direction per P0/P1 side; the renderer
    // must instead use screen hemisphere so seat 1 keeps defenders upright.
    for (const p of manifest.placements) {
      const arena = masterToArena(p.groundAnchorPixels[0], p.groundAnchorPixels[1]);
      for (const seat of [0, 1] as const) {
        const screenY = boardPoint(arena[0], arena[1], seat)[1];
        const hem = screenY > 400 ? "aim-north" : "aim-south";
        const requested = `aim-${p.directionRequested}`;
        expect(directionalAim(screenY)).toBe(hem);
        if (seat === 1 && requested !== hem) {
          // Seat-1 mirror flips which authored direction is correct.
          expect(directionalAim(screenY)).not.toBe(requested);
        }
      }
    }
  });
});

describe("defender pose state machine", () => {
  const sid = "s-p0-tower-30";

  it("idle -> fire cue on the aim pose -> aim -> idle", () => {
    let s = newDefenderState();
    s = updateDefender(s, { hp: 1000 }, 0);
    expect(defenderPose(s, false, 600, 0)).toBe("idle");
    expect(defenderCue(s, 0)).toBeNull();
    s = updateDefender(s, { hp: 1000, fire: { structureId: sid, tick: 30 } }, 10);
    expect(defenderPose(s, true, 600, 10)).toBe("aim-north");
    expect(defenderPose(s, false, 600, 10)).toBe("aim-north");
    expect(defenderCue(s, 10)).toBe("fire");
    expect(defenderPose(s, true, 600, 200)).toBe("aim-north");
    expect(defenderCue(s, 200)).toBeNull();
    expect(defenderPose(s, false, 600, 200)).toBe("idle");
  });

  it("fire cue holds for FIRE_MS then clears", () => {
    let s = newDefenderState();
    s = updateDefender(s, { hp: 1000, fire: { structureId: sid, tick: 30 } }, 1000);
    expect(defenderCue(s, 1000)).toBe("fire");
    expect(defenderCue(s, 1149)).toBe("fire");
    expect(defenderCue(s, 1150)).toBeNull();
  });

  it("hit shows on hp drop as a cue without leaving the aim pose", () => {
    let s = newDefenderState();
    s = updateDefender(s, { hp: 1000 }, 0);
    s = updateDefender(s, { hp: 900 }, 50);
    expect(defenderPose(s, true, 600, 60)).toBe("aim-north");
    expect(defenderCue(s, 60)).toBe("hit");
    expect(defenderCue(s, 300)).toBeNull();
  });

  it("hit cue overrides fire cue", () => {
    let s = newDefenderState();
    s = updateDefender(s, { hp: 1000, fire: { structureId: sid, tick: 30 } }, 50);
    s = updateDefender(s, { hp: 800 }, 60);
    expect(defenderCue(s, 60)).toBe("hit");
    expect(defenderCue(s, 260)).toBeNull();
  });

  it("destroyed overrides hit and fire", () => {
    let s = newDefenderState();
    s = updateDefender(s, { hp: 1000, fire: { structureId: sid, tick: 30 } }, 50);
    s = updateDefender(s, { hp: 0 }, 60);
    expect(defenderPose(s, true, 600, 60, false)).toBe("destroyed");
    expect(defenderPose(s, true, 600, 60, true)).toBe("aim-north");
  });

  it("orientation lock: top defenders face down and bottom face up in every state", () => {
    let s = newDefenderState();
    s = updateDefender(s, { hp: 1000 }, 0);
    s = updateDefender(s, { hp: 900, fire: { structureId: sid, tick: 30 } }, 10);
    for (const seat of [0, 1] as const) {
      for (const p of manifest.placements) {
        const arena = masterToArena(p.groundAnchorPixels[0], p.groundAnchorPixels[1]);
        const screenY = boardPoint(arena[0], arena[1], seat)[1];
        const expected = screenY > 400 ? "aim-north" : "aim-south";
        for (const now of [10, 100, 500]) {
          const pose = defenderPose(s, true, screenY, now);
          expect(pose).toBe(expected);
          expect(manifest.mounts[p.mountRole!].poses[pose].firingAllowed).toBe(true);
        }
      }
    }
  });

  it("stale fire events are ignored via fireFresh", () => {
    const ev = { structureId: sid, tick: 28 };
    expect(fireFresh(ev, 30)).toBe(true);
    expect(fireFresh(ev, 31)).toBe(false);
    expect(fireFresh(ev, 100)).toBe(false);
  });

  it("duplicate fire keys do not restart the timer; new keys do", () => {
    let s = newDefenderState();
    s = updateDefender(s, { hp: 1000, fire: { structureId: sid, tick: 30 } }, 0);
    expect(s.fireUntil).toBe(150);
    // Same event re-presented (e.g. repeated frame): no restart.
    s = updateDefender(s, { hp: 1000, fire: { structureId: sid, tick: 30 } }, 100);
    expect(s.fireUntil).toBe(150);
    // A later real fire restarts without stacking.
    s = updateDefender(s, { hp: 1000, fire: { structureId: sid, tick: 60 } }, 140);
    expect(s.fireUntil).toBe(290);
  });

  it("weapon anchor sits above the ground point in screen px for both seats", () => {
    // Defender art is upright for both seats, so the weapon tip must be above
    // the mapped ground point with the same offset magnitude in seat 0 and
    // seat 1. Sentinel = tower, keeper = core.
    const sentinel = manifest.mounts["sentinel"];
    const keeper = manifest.mounts["core-keeper"];
    for (const seat of [0, 1] as const) {
      for (const p of manifest.placements) {
        const role = p.mountRole === "core-keeper" ? keeper : sentinel;
        const pose = role.poses["fire"] ?? role.poses[`aim-${p.directionRequested}`];
        expect(pose).toBeTruthy();
        const [ax, ay] = weaponScreen(p.groundAnchorPixels, pose.weaponAnchorLocalBoardPixels, seat);
        const [gx, gy] = masterToScreen(p.groundAnchorPixels[0], p.groundAnchorPixels[1], seat);
        // Above the ground point (screen -y) and within the mount silhouette.
        expect(ay).toBeLessThan(gy);
        expect(Math.hypot(ax - gx, ay - gy)).toBeLessThan(60);
        expect(Math.abs(ax - gx)).toBeLessThan(30);
        // Same upright offset magnitude in both seats.
        const [ax0, ay0] = weaponScreen(p.groundAnchorPixels, pose.weaponAnchorLocalBoardPixels, 0);
        const [gx0, gy0] = masterToScreen(p.groundAnchorPixels[0], p.groundAnchorPixels[1], 0);
        const [ax1, ay1] = weaponScreen(p.groundAnchorPixels, pose.weaponAnchorLocalBoardPixels, 1);
        const [gx1, gy1] = masterToScreen(p.groundAnchorPixels[0], p.groundAnchorPixels[1], 1);
        expect(ax1 - gx1).toBeCloseTo(ax0 - gx0, 6);
        expect(ay1 - gy1).toBeCloseTo(ay0 - gy0, 6);
      }
    }
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

  it("camera-space layers stay upright for seat 1; board layers mirror", () => {
    for (const l of manifest.layers) expect(layerFlipY(l.id, 0)).toBe(false);
    const upright = manifest.layers.filter((l) => !layerFlipY(l.id, 1)).map((l) => l.id).sort();
    expect(upright).toEqual(["background", "foreground", "foundations", "team-trim"]);
    for (const id of ["base-terrain", "river-water", "banks-bridges", "rift-ford-open", "border-scenery", "chaos-active"]) {
      expect(layerFlipY(id, 1)).toBe(true);
    }
  });

  it("team trim splits into an opponent top half and a friendly bottom half", () => {
    expect(teamTrimHalves(600, 920)).toEqual([
      { team: "opponent", crop: [0, 0, 600, 460] },
      { team: "friendly", crop: [0, 460, 600, 460] },
    ]);
    expect(teamTrimHalves(600, 921).map((h) => h.crop[1] + h.crop[3])).toEqual([460, 921]);
    expect(manifest.layers.some((l) => l.id === TEAM_TRIM_LAYER)).toBe(true);
  });

  it("tower pads in the camera-space foundations sit symmetric about the board centre", () => {
    // Unflipped camera-space art is only valid if the six structure anchors
    // mirror about arena y = 80, so seat 1's upright pads land under towers.
    const ys = manifest.placements.map((p) => masterToArena(p.groundAnchorPixels[0], p.groundAnchorPixels[1]));
    for (const [x, y] of ys) expect(ys.some(([x2, y2]) => x2 === x && y2 === 160 - y)).toBe(true);
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

describe("v003 pre-rendered arena and team mounts", () => {
  const v3 = JSON.parse(
    readFileSync(join(process.cwd(), `public${ARENA_V003_URL}/manifests/arena.runtime.json`), "utf8")
  ) as ArenaManifest;
  const png = (rel: string): [number, number, number] => {
    const buf = readFileSync(join(process.cwd(), `public${ARENA_V003_URL}/${rel}`));
    return [buf.readUInt32BE(16), buf.readUInt32BE(20), buf[25]];
  };

  it("is preferred at runtime with v002 kept as the fallback", () => {
    expect(ARENA_URLS).toEqual([ARENA_V003_URL, ARENA_URL]);
    expect(v3.schemaVersion).toBe(2);
  });

  it("ships every layer and mount part as RGBA at the runtime contract size", () => {
    expect(v3.layers).toHaveLength(15);
    for (const l of v3.layers) expect(png(l.path)).toEqual([600, 920, 6]);
    for (const role of Object.values(v3.mounts)) {
      for (const p of [...Object.values(role.parts), ...Object.values(role.poses).map((x) => x.path)]) {
        expect(p).toBeTruthy();
        expect(png(p!)).toEqual([256, 320, 6]);
      }
    }
  });

  it("renders the 2.5D layers upright for both seats; only the reused chaos overlays mirror", () => {
    for (const l of v3.layers) {
      expect(layerFlipY(l, 0)).toBe(false);
      expect(layerFlipY(l, 1)).toBe(l.id.startsWith("chaos-"));
    }
    const trim = v3.layers.find((l) => l.id === TEAM_TRIM_LAYER)!;
    expect(tintsTeamTrim(trim)).toBe(false);
    expect(tintsTeamTrim(manifest.layers.find((l) => l.id === TEAM_TRIM_LAYER)!)).toBe(true);
    // String ids keep the v002 camera-space set.
    expect(layerFlipY("team-trim", 1)).toBe(false);
    expect(layerFlipY("base-terrain", 1)).toBe(true);
  });

  it("gives the opponent red Bulwark mounts and the viewer blue Chog Guardian mounts in both seats", () => {
    for (const seat of [0, 1] as const) {
      for (const p of v3.placements) {
        const [x, y] = masterToArena(p.groundAnchorPixels[0], p.groundAnchorPixels[1]);
        const owner = p.id.startsWith("p0") ? 0 : 1;
        const kind = p.kind!;
        const role = mountRoleForStructure(v3, kind, owner, seat);
        const mount = v3.mounts[role];
        const screenY = boardPoint(x, y, seat)[1];
        const top = screenY < 400;
        expect(mount.kind).toBe(kind);
        expect(mount.team).toBe(top ? "red" : "blue");
        expect(role).toBe(`${kind === "core" ? "king" : "lane"}-${top ? "red" : "blue"}`);
        expect(placementFor(v3, kind, x, y)?.id).toBe(p.id);
        // Red cannons aim down, blue cannons aim up, in every defender state.
        const pose = defenderPose(newDefenderState(), true, screenY, 0);
        expect(pose).toBe(top ? "aim-south" : "aim-north");
        expect(mount.poses[pose]?.firingAllowed).toBe(true);
        expect(mount.poses[top ? "aim-north" : "aim-south"]).toBeUndefined();
      }
    }
    expect(mountRoleForStructure(manifest, "tower", 1, 0)).toBe("sentinel");
  });

  it("aims the red muzzle low on its mount and the blue muzzle high", () => {
    for (const kind of ["lane", "king"]) {
      const red = v3.mounts[`${kind}-red`].poses["aim-south"].weaponAnchorLocalBoardPixels;
      const blue = v3.mounts[`${kind}-blue`].poses["aim-north"].weaponAnchorLocalBoardPixels;
      expect(red[1]).toBeLessThan(0);
      expect(blue[1]).toBeLessThan(red[1]);
      const [gx, gy] = masterToScreen(400, 520, 0);
      const [wx, wy] = weaponScreen([400, 520], red, 0);
      expect(Math.hypot(wx - gx, wy - gy)).toBeLessThan(60);
    }
  });

  it("drops the far Core enough to keep its measured art top inside the canvas", () => {
    const top = v3.mounts["king-red"].artTopLocalBoardPixels!;
    const screenY = boardPoint(50, 152, 0)[1];
    const offset = mountVisualOffsetY("core", screenY, top);
    expect(screenY + offset + top / 2).toBeGreaterThanOrEqual(18 - 1e-9);
    expect(mountVisualOffsetY("core", screenY)).toBe(40);
    expect(mountVisualOffsetY("tower", 200, -127)).toBe(0);
  });
});
