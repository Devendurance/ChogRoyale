# Battle world correction (PR #24)

The owner rejected the previous direction: a boxed 100:160 board, a permanent purple score header, CSS terrain filler and an opaque card tray. These captures show the corrected build.

## What is in these captures

Every capture is a presentation fixture. A local, in-memory `BattleSession` ran the real engine with legal deploy intents from both seats, and its frames were played through the shipped `BattleHud` and `BattleCanvas` on a temporary local route (`/dev/battle/qa-world`). That route was deleted and never committed. Frames were not edited. None of this is a live PvP test, authenticated multiplayer or real-device evidence.

The owner's third-party reference media stayed local in `.local-references/`. It is not committed or published here.

| Viewport | Combat | Crown flight |
| --- | --- | --- |
| 390x844 seat 0 | [combat](390x844-seat0-combat.jpg) | [flight](390x844-seat0-crown-flight.jpg) |
| 390x844 seat 1 | [combat](390x844-seat1-combat.jpg) | [flight](390x844-seat1-crown-flight.jpg) |
| 430x932 | [combat](430x932-seat0-combat.jpg) | [flight](430x932-seat0-crown-flight.jpg) |
| 768x1024 seat 0 | [combat](768x1024-seat0-combat.jpg) | [flight](768x1024-seat0-crown-flight.jpg) |
| 768x1024 seat 1 | [combat](768x1024-seat1-combat.jpg) | [flight](768x1024-seat1-crown-flight.jpg) |
| 820x1180 | [combat](820x1180-seat0-combat.jpg) | [flight](820x1180-seat0-crown-flight.jpg) |
| 1366x768 desktop regression | [combat](1366x768-seat0-combat.jpg) | [flight](1366x768-seat0-crown-flight.jpg) |

The before captures (`before-*.jpg`) are the rejected PR #24 state. The recordings are [phone 390x844](battle-phone-390x844.mp4) and [tablet 768x1024](battle-tablet-768x1024.mp4). Both include page load, then deployed troops, the tower destruction, the crown flights and later combat.

## Measured world and camera bounds

CSS px. The canvas covers the full viewport in portrait, and the camera fits the 500x800 board above the measured hand tray. Full data is in [metrics.json](metrics.json).

| Viewport | Canvas | Board rect | Board share of width | Tray | Camera zoom | Backing |
| --- | --- | --- | ---: | --- | ---: | --- |
| 390x844 | 390x844 | x 0, y 37.5, 390x624 | 100% | y 693, h 151 | 1.56 | 780x1688 |
| 430x932 | 430x932 | x 0, y 43, 430x688 | 100% | y 767.7, h 164.3 | 1.72 | 860x1864 |
| 768x1024 | 768x1024 | x 136.5, y 6, 495x792 | 64% | y 798, h 226 | 1.98 | 1536x2048 |
| 820x1180 | 820x1180 | x 113.8, y 6, 592.5x948 | 72% | y 954, h 226 | 2.37 | 1640x2360 |
| 1366x768 | board-sized host (unchanged desktop layout) | x 516.6, y 170.3, 333x532.8 | n/a | side column | 0.666 | 500x800 |

On tablets everything beside the board is the rendered Chaos Crossing world surround: the same 52 degree camera, lighting and ground recipe, continued into forest, with the river running off both edges. It is not a CSS background. Projected anchors match the master grid exactly (`_world-geometry.json` in the asset work folder).

## Unit and structure size

Drawn idle heights in a busy frame (CSS px):

| Unit | 390x844 | 768x1024 | 820x1180 | Before at 390 |
| --- | ---: | ---: | ---: | ---: |
| Choglings (swarm) | 35.9 | 45.5 | 54.5 | 25.7 |
| Rift Sprites (flying swarm) | 34.3 | 43.6 | 52.1 | 24.3 |
| Riftbreaker (heavy) | 54.6 | 69.3 | 83.0 | 37.9 |

Class targets rose about 25% (titan 78 board px, about 15% of field width). Towers draw at 1.3x and Cores at 1.2x through `structureArtScale`, which scales the weapon anchors and HP plates with them.

## Runtime checks

- No document overflow at any size. No purple header band in portrait (`.chud-top` is `display: contents`, its pieces float over the world).
- Pointer mapping uses the board rect: 30%/75% of the board maps to arena (30, 40) for seat 0 and (30, 120) for seat 1. A point just left of the board, over the forest, maps to nothing. A mouse drag from the first card to 30%/70% of the board deployed at (30, 48) for seat 0 and (30, 112) for seat 1 at every size.
- Crown sequence: both crown counters start at 0. The recorded engine frames destroy one tower per side, the server crown totals go to 1 and 1, and each counter updates for the correct player in both seat perspectives. One flight per crown appears, starting at the destroyed tower's exact screen point (for example (117, 505.5) for the seat-0 west tower at 390x844) and landing on the matching counter with a "+1".
- The previous fixture never showed a flight because its harness passed a new `start` object on every render, which re-primes CrownCelebration. With a stable `start`, as the real BattlePanel passes, flights appear. Reconnect and replay deduplication is still covered by the existing crown-presentation tests, not by this browser run.

## Remaining limitations

- Fixture evidence only. Authenticated two-player play, real touch devices and safe-area notches are not covered.
- Unit sheets are packed near 1 sheet px per board px, so the larger class targets upsample them up to 1.5x (titan). They read a little softer than native. Repacking from the 2x masters would fix that.
- On tablets the hand reserves about 22% of the height, so the board covers 64-72% of the width. Shorter cards would make the board larger.
- Desktop at 1200px and wider keeps the existing three-column layout and was checked only for regressions.
