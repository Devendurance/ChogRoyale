# Landscape tablet and desktop battle world (PR #24)

This pass extends the approved portrait world (`1394982`) to tablet landscape, laptops and desktop. It keeps the same overlays in every orientation: opponent name top-left, timer top-right, crowns at the river on the field's right side, and the hand bottom-centre.

## What these captures are

Every capture comes from a deterministic presentation fixture. A local, in-memory `BattleSession` ran the real engine with legal intents, and its unedited frames played through the shipped `BattleHud` and `BattleCanvas` on a temporary local route. That route was deleted and never committed. None of this is live PvP, authenticated multiplayer or a real-device test. The owner's third-party references stayed local.

## Before and after

| Viewport | Before | After combat | After crown flight |
| --- | --- | --- | --- |
| 1024x768 tablet landscape | [before](before-1024x768.jpg) | [seat 0](1024x768-seat0-combat.jpg), [seat 1](1024x768-seat1-combat.jpg) | [seat 0](1024x768-seat0-crown-flight.jpg), [seat 1](1024x768-seat1-crown-flight.jpg) |
| 1180x820 large tablet | [before](before-1180x820.jpg) | [after](1180x820-seat0-combat.jpg) | [flight](1180x820-seat0-crown-flight.jpg) |
| 1280x800 laptop | [before](before-1280x800.jpg) | [after](1280x800-seat0-combat.jpg) | [flight](1280x800-seat0-crown-flight.jpg) |
| 1366x768 desktop | [before](before-1366x768.jpg) | [seat 0](1366x768-seat0-combat.jpg), [seat 1](1366x768-seat1-combat.jpg) | [seat 0](1366x768-seat0-crown-flight.jpg), [seat 1](1366x768-seat1-crown-flight.jpg) |
| 1920x1080 desktop | [before](before-1920x1080.jpg) | [after](1920x1080-seat0-combat.jpg) | [flight](1920x1080-seat0-crown-flight.jpg) |
| 390x844 portrait regression | approved baseline | [after](390x844-seat0-combat.jpg) | [flight](390x844-seat0-crown-flight.jpg) |
| 430x932 portrait regression | approved baseline | [after](430x932-seat0-combat.jpg) | [flight](430x932-seat0-crown-flight.jpg) |
| 768x1024 portrait regression | approved baseline | [after](768x1024-seat0-combat.jpg) | [flight](768x1024-seat0-crown-flight.jpg) |
| 820x1180 portrait regression | approved baseline | [after](820x1180-seat0-combat.jpg) | [flight](820x1180-seat0-crown-flight.jpg) |

Recordings: [1024x768](battle-1024x768.mp4), [1366x768](battle-1366x768.mp4) and [1920x1080](battle-1920x1080.mp4). Each shows page load, the full-screen world, regular and heavy troops in combat, towers, the hand and energy, and the recorded tower kills with crown flights and landing pulses.

## Measurements (CSS px)

Full data is in [metrics.json](metrics.json). "Field" is the playable 100x160 board rect. "Height" is the field's share of viewport height.

| Viewport | Field rect | Height | Area | Hand | Camera zoom | Canvas backing | Riftbreaker drawn |
| --- | --- | ---: | ---: | --- | ---: | --- | ---: |
| 1024x768 | x 310.8, y 4, 402.5x644 | 84% | 33% | 138.5 (18%) | 1.32 | 1673x1255 | 56.4 |
| 1180x820 | x 374.4, y 4, 431.3x690 | 84% | 31% | 144.2 (18%) | 1.27 | 1738x1208 | 60.4 |
| 1280x800 | x 430, y 4, 420x672 | 84% | 28% | 142 (18%) | 1.20 | 1833x1146 | 58.8 |
| 1366x768 | x 481.8, y 4, 402.5x644 | 84% | 25% | 138.5 (18%) | 1.00 | 1697x954 | 56.4 |
| 1920x1080 | x 672.2, y 4, 575.6x921 | 85% | 26% | 172.8 (16%) | 1.15 | 1920x1080 | 80.6 |
| 390x844 | x 0, y 37.5, 390x624 | 74% | 74% | 151 (18%) | 1.56 | 780x1688 | 54.6 |
| 430x932 | x 0, y 43, 430x688 | 74% | 74% | 164.3 (18%) | 1.72 | 860x1864 | 60.2 |
| 768x1024 | x 136.5, y 6, 495x792 | 77% | 50% | 226 (22%) | 1.62 | 1255x1673 | 69.3 |
| 820x1180 | x 113.8, y 6, 592.5x948 | 80% | 58% | 226 (19%) | 1.75 | 1208x1738 | 83.0 |

Before this pass, the 1024x768 board sat inside purple panels under a header, and the hand took about 38% of the height. Portrait field rects, hand heights and crown positions are identical to the approved baseline. Only the tablet canvas backing changed, from the new fill budget below.

## Camera and world strategy

- One rule everywhere: `boardLayout` fits the complete 500x800 board into the viewport minus the hand, centred, at its true 5:8 aspect. In landscape the field fills the height and the camera reveals world on both sides. In portrait it fills the width. The logical 100x160 arena and server positions are untouched.
- The world surround was re-rendered with the existing `build_world.py` (wider extent only, `WX0=-180 WX1=280`) and ships as a 2300x1400 WebP. Projected anchors match the master grid exactly. It covers about 1.6x more width than 1920x1080 needs.
- Desktop landscape (1200px and wider) loads a static depth-of-field variant. The blur ramps in from 40 px outside the arena canvas, and the arena region is pixel-identical (max difference 0). There is no runtime blur.
- Pointer mapping, the placement ghost and crown origins all read the same board rect. A point over the forest maps to nothing, so units cannot be deployed into scenery.

## Sprite sharpness

The class targets draw units at 1.2x-1.5x their packed size. The troops, commanders and the spawned unit were therefore repacked with the existing packer's documented `down` factor (1.5) from the existing 2x masters. That is about 1.33 sheet px per board px instead of 1. Drawn sizes, pivots and anchors are unchanged. Every other sheet repacked byte-identically from the same masters, except `decoy_totem`, which was left untouched. [Comparison at 1024x768](sharpness-1024x768-old-vs-new.png): faces and eyes resolve where they were smeared. The edge-energy measure rose from 14.3 to 15.4 on the same crop.

Limitation: troop textures went from 16.7 to 29.7 MB of RGBA and the whole unit package from 33.9 to 52.5 MB. The test budget was raised to 30/56 MB for this, so the owner should review it. Full 2x density would exceed the 6 MB per-sheet limit.

## Hand

Landscape card height is `clamp(82px, 11dvh, 128px)`. The NEXT card sits beside the four cards, energy sits directly under them at the same width, and commander abilities sit to their right. The board tucks under the hand's transparent top fade. The hand costs 16-18% of the height in landscape, against 38% before. Portrait is unchanged.

## Performance (indicative only)

Headless Chrome on Intel Iris Xe (ANGLE D3D11), dev build, dense combat ticks 440-520:

| Viewport | Before budget | After budget |
| --- | ---: | ---: |
| 1024x768 @2x | 29.6 fps (2048x1536 backing) | 35.9 fps |
| 820x1180 @2x | not measured | 34.9 fps |
| 1920x1080 @1x | 43.1 fps | 38.6 fps |
| 390x844 @3x | 43.3 fps | 45.1 fps |

1920x1080 at 1x is below both budgets, so its two readings show run-to-run variance. The canvas pixel budget dropped from 4.2M to 2.1M px after a 3.1M px backing measured at 30 fps while 1.8M px matched the 1x ceiling. A production build and real hardware will differ.

## Not verified

REAL-DEVICE TESTING UNVERIFIED: physical tablet rotation, touch gestures, notches and safe areas, browser chrome resizing, PWA display mode, high-DPI device sharpness, and audio timing on devices. Authenticated two-player play is also untested. Reconnect and replay deduplication of crown celebrations is covered by the existing crown-presentation tests, not this browser run. Reduced motion was not exercised in the browser.
