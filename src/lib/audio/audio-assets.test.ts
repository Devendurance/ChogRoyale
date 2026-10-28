import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIO_ASSET_VERSION,
  BATTLE_AUDIO_ASSETS,
  BATTLE_AUDIO_CUE_KEYS,
  BATTLE_MUSIC_ASSETS,
  UI_AUDIO_ASSETS,
  UI_AUDIO_CUE_KEYS,
  UI_SFX_ASSETS,
  MUSIC_ASSETS,
} from "./audio-assets";

describe("battle audio asset inventory", () => {
  it("keeps the core cue keys stable and covers every cue", () => {
    expect(AUDIO_ASSET_VERSION).toBe("v001");
    expect(Object.keys(BATTLE_AUDIO_ASSETS).sort()).toEqual([...BATTLE_AUDIO_CUE_KEYS].sort());
    expect(Object.values(BATTLE_AUDIO_ASSETS).every((asset) => asset.path === null)).toBe(true);
    expect(Object.keys(UI_AUDIO_ASSETS).sort()).toEqual([...UI_AUDIO_CUE_KEYS].sort());
    expect(Object.values(UI_AUDIO_ASSETS).filter((asset) => asset.path).length).toBe(16);
    expect(UI_SFX_ASSETS).toBe(UI_AUDIO_ASSETS);
    expect(MUSIC_ASSETS).toBe(BATTLE_MUSIC_ASSETS);
  });

  it("exposes the owner-supplied battle loop as the production Track B asset", () => {
    expect(BATTLE_MUSIC_ASSETS["track-a"].path).toBe("/assets/audio/v001/music/spooky-halloween.mp3");
    expect(BATTLE_MUSIC_ASSETS["track-b"].path).toBe("/assets/audio/v001/music/battle-loop.mp3");
    expect(BATTLE_MUSIC_ASSETS["track-b"].developmentPath).toBeNull();
    expect(BATTLE_MUSIC_ASSETS["track-b"].production).toBe(true);
    expect(BATTLE_MUSIC_ASSETS["track-b"].license).toBe("CC BY-NC 4.0");
    expect(BATTLE_MUSIC_ASSETS["track-b"].rightsStatus).toBe("owner-asserted-purchased-rights");
    expect(BATTLE_MUSIC_ASSETS["track-b"].provenance).toBe("owner-supplied-purchased-rights");
    expect(existsSync(resolve(process.cwd(), "public/assets/audio/v001/music/battle-loop.mp3"))).toBe(true);
  });
});
