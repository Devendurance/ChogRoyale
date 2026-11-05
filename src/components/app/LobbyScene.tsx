// The scenic layer behind the authenticated home lobby.
//
// It is intentionally one optimized Chaos Crossing world image plus CSS
// atmosphere. No Phaser instance, no second renderer and no runtime blur over
// the full viewport. The component only mounts in LobbyView's ready state, so
// gates, the battle HUD and every other authenticated route keep their own
// backgrounds.

import Image from "next/image";

const LOBBY_WORLD = "/assets/arena/chaos-crossing/v003/layers/world-surround-soft.webp";

export default function LobbyScene() {
  return (
    <div className="app-home-scene" aria-hidden="true">
      <Image
        src={LOBBY_WORLD}
        alt=""
        fill
        priority
        sizes="100vw"
        className="app-home-scene__image"
      />
      <span className="app-home-scene__glow" />
      <span className="app-home-scene__mist" />
    </div>
  );
}
