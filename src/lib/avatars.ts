export interface AvatarEntry {
  id: string;
  name: string;
  assetUrl: string;
  primaryColor: string;
  secondaryColor: string;
}

// Starter catalog of original geometric avatars. IDs are stable permanent
// references stored on the player row; artwork lives under /avatars and can
// later extend to NFT-derived entries without changing this contract.
const CATALOG: AvatarEntry[] = [
  { id: "chog-ember", name: "Ember", assetUrl: "/avatars/chog-ember.svg", primaryColor: "#f97316", secondaryColor: "#7c2d12" },
  { id: "chog-frost", name: "Frost", assetUrl: "/avatars/chog-frost.svg", primaryColor: "#38bdf8", secondaryColor: "#0c4a6e" },
  { id: "chog-spark", name: "Spark", assetUrl: "/avatars/chog-spark.svg", primaryColor: "#facc15", secondaryColor: "#713f12" },
  { id: "chog-moss", name: "Moss", assetUrl: "/avatars/chog-moss.svg", primaryColor: "#4ade80", secondaryColor: "#14532d" },
  { id: "chog-tide", name: "Tide", assetUrl: "/avatars/chog-tide.svg", primaryColor: "#2dd4bf", secondaryColor: "#134e4a" },
  { id: "chog-dusk", name: "Dusk", assetUrl: "/avatars/chog-dusk.svg", primaryColor: "#a78bfa", secondaryColor: "#4c1d95" },
  { id: "chog-stone", name: "Stone", assetUrl: "/avatars/chog-stone.svg", primaryColor: "#a8a29e", secondaryColor: "#44403c" },
  { id: "chog-gale", name: "Gale", assetUrl: "/avatars/chog-gale.svg", primaryColor: "#fb7185", secondaryColor: "#881337" },
];

export const DEFAULT_AVATAR_ID = "chog-ember";

export function listAvatars(): AvatarEntry[] {
  return CATALOG.map((a) => ({ ...a }));
}

export function getAvatar(id: unknown): AvatarEntry | null {
  if (typeof id !== "string") return null;
  return CATALOG.find((a) => a.id === id) ?? null;
}

export function isValidAvatarId(id: unknown): boolean {
  return getAvatar(id) !== null;
}
