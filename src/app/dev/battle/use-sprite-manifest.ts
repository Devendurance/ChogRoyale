"use client";

// Shared client hook for the imported v001 runtime manifest. One fetch for
// the whole app, cached at module level. Null means placeholder rendering.
import { useEffect, useState } from "react";
import type { SpriteManifest } from "./sprite-registry";

const MANIFEST_URL = "/assets/chog-kit/v001/manifests/phaser-assets.runtime.json";

let cached: Promise<SpriteManifest | null> | null = null;

export function spriteManifestPromise(): Promise<SpriteManifest | null> {
  cached ??= fetch(MANIFEST_URL)
    .then((r) => (r.ok ? (r.json() as Promise<SpriteManifest>) : null))
    .catch(() => null);
  return cached;
}

export function useSpriteManifest(): SpriteManifest | null {
  const [m, setM] = useState<SpriteManifest | null>(null);
  useEffect(() => {
    let live = true;
    void spriteManifestPromise().then((v) => {
      if (live) setM(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return m;
}
