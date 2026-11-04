# Chog Royale battle viewport acceptance

These captures use the deterministic recorded battle fixture at `/dev/battle/qa-shell`. The fixture renders the shipped BattleHud, BattleCanvas, tower sprites, troop sprites, arena art, card hand, and energy tray. It is clearly labeled as a presentation fixture and does not represent an authenticated multiplayer session.

## Before and after

| Viewport | Before | After |
| --- | --- | --- |
| 390x844 | [before](before-390x844.png) | [after](after-390x844.png) |
| 430x932 | historical baseline unavailable | [after](after-430x932.png) |
| 768x1024 | historical baseline unavailable | [after](after-768x1024.png) |
| 1366x768 | [before](before-1366x768.png) | [after](after-1366x768.png) |

## Measured bounds

Values are CSS pixels. The playable canvas remains 100:160, about 0.625, at every capture. `screenPercent` is playable canvas area divided by viewport area. Full measurements are in [metrics.json](metrics.json).

| Viewport | Canvas bounds | Arena surface | Playable screen area | Unused side space | Unused vertical space |
| --- | --- | --- | ---: | ---: | ---: |
| 390x844 | x 6, y 84.77, 378 x 604.80 | x 6, y 80, 378 x 614.34 | 69.45% | 12 px | 239.20 px |
| 430x932 | x 6, y 90.09, 417.98 x 668.80 | x 6, y 80, 418 x 689 | 69.75% | 12.02 px | 263.11 px |
| 768x1024 | x 149, y 80, 470 x 752 | x 6, y 80, 756 x 752 | 44.94% | 298 px | 192 px |
| 1366x768 | x 516.59, y 174.25, 332.81 x 532.50 | x 479.06, y 129, 407.88 x 623 | 16.89% | 1033.19 px | 235.50 px |

The portrait rule is `min(100cqw, 62.5cqh)`, the exact width cap for a complete 100:160 board. At 390px and 430px the playable canvas reaches the arena edges. At 768x1024, the viewport is wider than the board's aspect ratio permits. The remaining area is filled with the existing Chaos Crossing terrain as a noninteractive, full-colour continuation. The board's gameplay coordinates, hit testing, deployment bounds, and pointer mapping are unchanged.

## Runtime checks

- Fixture crowns changed immediately on recorded authoritative tower destruction for both seat perspectives: seat 0 `0/1 -> 0/2`, seat 1 `1/0 -> 2/0`.
- The existing crown presentation tests cover deduplication and reduced-motion behavior. The browser probe verified the score transition, but did not observe a separate DOM flight node in this fixture, so no browser-visible flight animation claim is made.
- The representative 604 -> 875 fixture sequence contains a confirmed tower death and crown delta. The browser probe observed the score update, but no `.chud-crown-flight` node or landing pulse appeared, so the visual flight remains unverified.
- The fixture showed no document overflow. Cards, energy, HUD, and the battlefield remained visible at all four sizes.
- The final captures remove only the Next.js development portal. The public player route was not modified and still responds through the existing app shell.
- Authenticated two-player deployment and real-device safe-area acceptance remain outside this fixture evidence.
