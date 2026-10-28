/**
 * Versioned browser audio inventory. BattleAudio may use these files as an
 * optional layer over its original Web Audio fallback. The map is deliberately
 * pure and contains no secrets, account data, network calls or generator API.
 */

export const AUDIO_ASSET_VERSION = "v001" as const;

export const BATTLE_AUDIO_CUE_KEYS = [
  "start",
  "select",
  "deploy",
  "spawn",
  "reject",
  "spell",
  "fire",
  "impact",
  "structure-hit",
  "death",
  "destroy",
  "crown-earned",
  "crown-tally",
  "ability",
  "ability-impact",
  "chaos-warning",
  "chaos-active",
  "chaos-expired",
  "victory",
  "defeat",
  "draw",
] as const;

export type BattleAudioCueKey = (typeof BATTLE_AUDIO_CUE_KEYS)[number];

export const UI_AUDIO_CUE_KEYS = [
  "primary",
  "secondary",
  "navigation",
  "card-select",
  "card-drag",
  "placement",
  "success",
  "error",
  "friend-request",
  "notification",
  "invite",
  "ready",
  "upgrade",
  "reward",
  "confirm",
  "reveal",
] as const;

export type UiAudioCueKey = (typeof UI_AUDIO_CUE_KEYS)[number];

export type AudioAssetProvenance =
  | "local-procedural-fallback"
  | "web-audio-procedural-fallback"
  | "licensed-cc0"
  | "development-only-cc-by-nc"
  | "owner-supplied-purchased-rights";

export interface BattleAudioAsset {
  cue: BattleAudioCueKey;
  path: string | null;
  mimeType: "audio/mpeg" | null;
  durationSeconds: number | null;
  production: boolean;
  provenance: AudioAssetProvenance;
}

export interface UiAudioAsset {
  cue: UiAudioCueKey;
  path: string;
  mimeType: "audio/mpeg";
  durationSeconds: number;
  production: true;
  provenance: "local-procedural-fallback";
}

export interface BattleMusicAsset {
  id: "track-a" | "track-b";
  path: string | null;
  developmentPath: string | null;
  mimeType: "audio/mpeg";
  durationSeconds: number;
  loop: boolean;
  production: boolean;
  credit: string;
  sourceUrl: string;
  license: string;
  rightsStatus: "cleared" | "owner-asserted-purchased-rights";
  rightsNote: string;
  provenance: AudioAssetProvenance;
}

const webAudioFallback = (cue: BattleAudioCueKey): BattleAudioAsset => ({
  cue,
  path: null,
  mimeType: null,
  durationSeconds: null,
  production: true,
  provenance: "web-audio-procedural-fallback",
});

const uiSfx = (cue: UiAudioCueKey, durationSeconds: number): UiAudioAsset => ({
  cue,
  path: `/assets/audio/v001/sfx/${cue}.mp3`,
  mimeType: "audio/mpeg",
  durationSeconds,
  production: true,
  provenance: "local-procedural-fallback",
});

export const UI_AUDIO_ASSETS: Record<UiAudioCueKey, UiAudioAsset> = {
  primary: uiSfx("primary", 0.12),
  secondary: uiSfx("secondary", 0.08),
  navigation: uiSfx("navigation", 0.1),
  "card-select": uiSfx("card-select", 0.14),
  "card-drag": uiSfx("card-drag", 0.12),
  placement: uiSfx("placement", 0.22),
  success: uiSfx("success", 0.42),
  error: uiSfx("error", 0.2),
  "friend-request": uiSfx("friend-request", 0.25),
  notification: uiSfx("notification", 0.22),
  invite: uiSfx("invite", 0.3),
  ready: uiSfx("ready", 0.25),
  upgrade: uiSfx("upgrade", 1),
  reward: uiSfx("reward", 0.48),
  confirm: uiSfx("confirm", 0.16),
  reveal: uiSfx("reveal", 0.36),
};

export const BATTLE_AUDIO_ASSETS: Record<BattleAudioCueKey, BattleAudioAsset> = {
  start: webAudioFallback("start"),
  select: webAudioFallback("select"),
  deploy: webAudioFallback("deploy"),
  spawn: webAudioFallback("spawn"),
  reject: webAudioFallback("reject"),
  spell: webAudioFallback("spell"),
  fire: webAudioFallback("fire"),
  impact: webAudioFallback("impact"),
  "structure-hit": webAudioFallback("structure-hit"),
  death: webAudioFallback("death"),
  destroy: webAudioFallback("destroy"),
  "crown-earned": webAudioFallback("crown-earned"),
  "crown-tally": webAudioFallback("crown-tally"),
  ability: webAudioFallback("ability"),
  "ability-impact": webAudioFallback("ability-impact"),
  "chaos-warning": webAudioFallback("chaos-warning"),
  "chaos-active": webAudioFallback("chaos-active"),
  "chaos-expired": webAudioFallback("chaos-expired"),
  victory: webAudioFallback("victory"),
  defeat: webAudioFallback("defeat"),
  draw: webAudioFallback("draw"),
};

export const BATTLE_MUSIC_ASSETS: Record<"track-a" | "track-b", BattleMusicAsset> = {
  "track-a": {
    id: "track-a",
    path: "/assets/audio/v001/music/spooky-halloween.mp3",
    developmentPath: null,
    mimeType: "audio/mpeg",
    durationSeconds: 49.55,
    loop: true,
    production: true,
    credit: "Misterbates - Spooky Halloween",
    sourceUrl: "https://freesound.org/people/MusicByMisterbates/sounds/677436/",
    license: "CC0",
    rightsStatus: "cleared",
    rightsNote: "CC0 source license.",
    provenance: "licensed-cc0",
  },
  "track-b": {
    id: "track-b",
    path: "/assets/audio/v001/music/battle-loop.mp3",
    developmentPath: null,
    mimeType: "audio/mpeg",
    durationSeconds: 33.409093,
    loop: true,
    production: true,
    credit: "Mrthenoronha - Village game theme loop",
    sourceUrl: "https://freesound.org/people/Mrthenoronha/sounds/520710/",
    license: "CC BY-NC 4.0",
    rightsStatus: "owner-asserted-purchased-rights",
    rightsNote: "The project owner asserts purchased usage rights. Purchase documentation is not stored in this repository.",
    provenance: "owner-supplied-purchased-rights",
  },
};

export const BATTLE_AUDIO_MANIFEST = {
  version: AUDIO_ASSET_VERSION,
  generatedSfxCount: 16,
  externalGenerator: {
    provider: "ElevenLabs",
    status: "free-tier-no-commercial-entitlement",
    runtimeUse: false,
  },
  cueKeys: BATTLE_AUDIO_CUE_KEYS,
  uiCueKeys: UI_AUDIO_CUE_KEYS,
  uiCues: UI_AUDIO_ASSETS,
  cues: BATTLE_AUDIO_ASSETS,
  music: BATTLE_MUSIC_ASSETS,
} as const;

// Short aliases used by the app audio core and settings surface.
export const UI_SFX_ASSETS = UI_AUDIO_ASSETS;
export const MUSIC_ASSETS = BATTLE_MUSIC_ASSETS;

export function audioAssetForCue(cue: BattleAudioCueKey): BattleAudioAsset {
  return BATTLE_AUDIO_ASSETS[cue];
}

export function uiAudioAssetForCue(cue: UiAudioCueKey): UiAudioAsset {
  return UI_AUDIO_ASSETS[cue];
}
