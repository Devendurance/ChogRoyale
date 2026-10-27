// Phaser side of the final battle VFX. Turns pure VfxSprite specs from
// battle-vfx.ts into short-lived images, animates them by timestamp, keeps the
// live count under VFX_LIMITS and destroys every image when its life ends or
// the match resets. Keyed images (status markers, comet flights, styled
// projectiles) live until the caller stops touching them in a frame.

import type Phaser from "phaser";
import { admitSprites, easeFor, spriteAlpha, vfxKey, type VfxManifest, type VfxSprite } from "./battle-vfx";

type PhaserModule = typeof Phaser;
type Img = Phaser.GameObjects.Image;

const DEPTH = { ground: 0.6, top: 1650 } as const;

interface Live {
  img: Img;
  s: VfxSprite;
  born: number;
}

export class VfxLayer {
  private live: Live[] = [];
  private keyed = new Map<string, Img>();
  private touched = new Set<string>();

  constructor(
    private scene: Phaser.Scene,
    private P: PhaserModule,
    private manifest: VfxManifest | null,
    private missing: Set<string>,
    private reduced: boolean
  ) {}

  /** True when a texture loaded, so callers can keep their Graphics fallback otherwise. */
  has(tex: string): boolean {
    return !!this.manifest?.textures[tex] && !this.missing.has(vfxKey(tex)) && this.scene.textures.exists(vfxKey(tex));
  }

  get count(): number {
    return this.live.length;
  }

  /** Spawns one-shot sprites, dropping any beyond the live cap. */
  spawn(specs: VfxSprite[], now: number) {
    for (const s of admitSprites(this.live.length, specs.filter((sp) => this.has(sp.tex)))) {
      const img = this.scene.add.image(-999, -999, vfxKey(s.tex), s.frame ?? 0);
      this.style(img, s);
      img.setVisible(false);
      this.live.push({ img, s, born: now });
    }
  }

  private style(img: Img, s: VfxSprite) {
    img.setOrigin(...(s.origin ?? [0.5, 0.5]));
    img.setDepth(DEPTH[s.layer]);
    img.setBlendMode(s.blend === "add" ? this.P.BlendModes.ADD : this.P.BlendModes.NORMAL);
    if (s.tint !== undefined) img.setTint(s.tint);
  }

  /** Advances every one-shot sprite. `project` maps arena units to board px for this seat. */
  update(now: number, project: (x: number, y: number) => [number, number]) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i]!;
      const s = l.s;
      const age = now - l.born - (s.delay ?? 0);
      if (age < 0) continue;
      const t = age / s.life;
      if (t >= 1) {
        l.img.destroy();
        this.live.splice(i, 1);
        continue;
      }
      this.place(l.img, s, t, project);
    }
  }

  private place(img: Img, s: VfxSprite, t: number, project: (x: number, y: number) => [number, number]) {
    const e = easeFor(s.ease, t);
    const tx = s.to ? s.x + (s.to.x - s.x) * e : s.x;
    const ty = s.to ? s.y + (s.to.y - s.y) * e : s.y;
    const [px, py] = project(tx, ty);
    const lift = (s.lift ?? 0) + ((s.lift1 ?? s.lift ?? 0) - (s.lift ?? 0)) * e + (s.arc ? Math.sin(t * Math.PI) * s.arc : 0);
    const sc = s.scale + ((s.scale1 ?? s.scale) - s.scale) * (this.reduced ? 0 : e);
    img.setVisible(true).setPosition(px + (s.dx ?? 0), py + (s.dy ?? 0) - lift).setScale(sc, sc * (s.sy ?? 1)).setAlpha(Math.max(0, Math.min(1, spriteAlpha(s, t))));
    if (s.animate) {
      const frames = this.manifest?.textures[s.tex]?.frames ?? 1;
      img.setFrame(Math.min(frames - 1, Math.floor(t * frames)));
    }
    if (s.aim && s.to) {
      const [ax, ay] = project(s.x, s.y);
      const [bx, by] = project(s.to.x, s.to.y);
      img.setRotation(Math.atan2(by - ay, bx - ax));
    } else {
      img.setRotation((s.rot ?? 0) + (s.spin ?? 0) * ((t * s.life) / 1000));
    }
  }

  /**
   * Keyed image that persists while the caller touches it each frame.
   * Returns null when the texture is unavailable (callers keep a fallback).
   */
  keyedImage(key: string, tex: string, layer: VfxSprite["layer"], blend: VfxSprite["blend"], tint?: number, frame = 0): Img | null {
    if (!this.has(tex)) return null;
    this.touched.add(key);
    let img = this.keyed.get(key);
    if (!img) {
      img = this.scene.add.image(-999, -999, vfxKey(tex), frame);
      this.style(img, { tex, x: 0, y: 0, life: 1, scale: 1, layer, blend, tint });
      this.keyed.set(key, img);
    }
    return img;
  }

  /** Destroys keyed images not touched since the previous sweep. */
  sweep() {
    for (const [key, img] of this.keyed) {
      if (this.touched.has(key)) continue;
      img.destroy();
      this.keyed.delete(key);
    }
    this.touched.clear();
  }

  clear() {
    for (const l of this.live) l.img.destroy();
    this.live.length = 0;
    for (const img of this.keyed.values()) img.destroy();
    this.keyed.clear();
    this.touched.clear();
  }
}
