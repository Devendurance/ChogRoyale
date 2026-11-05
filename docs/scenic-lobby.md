# Scenic Chaos Crossing lobby

Date: 2026-11-05. Branch `feat/next-player-experience`. Draft PR #26.
No merge, deployment, production migration or live flag change.

## Scope

This slice changes only the ready authenticated home at `/app`. The login,
booting and profile gates keep their existing presentation. The battle HUD,
Phaser arena, Training Camp, card modal, navigation coach, public site and
every other authenticated route keep their own backgrounds.

The scenic layer is mounted by `LobbyView` and never by the shared `/app`
layout, so a route change cannot leak the world into Decks, Play, Progress,
Profile or Settings.

## Existing art selected

Primary background:
`public/assets/arena/chaos-crossing/v003/layers/world-surround-soft.webp`
(2300x1400, 400,918 bytes).

Why the soft variant:
- It is the existing approved Chaos Crossing world, not a newly generated
  environment.
- The arena region stays pixel-identical to the sharp variant while the outer
  scenery is already softened. That keeps the central battleground readable
  without a runtime full-viewport blur.
- It is 343 KB smaller than `world-surround.webp`.

The commander stage keeps its existing v002 treeline and ambient layers. Only
the violet wash is removed on the home screen, so the stage now shares the
same forest air as the world behind it.

## Composition

Layers in order:
1. A dark forest gradient fallback, so a failed image still leaves a green
   scene.
2. The optimized world image, `object-fit: cover`, positioned at `50% 52%`
   and `50% 56%` on phones so the central clearing stays visible.
3. A warm light bloom from the top, a soft vignette and a darker forest floor.
4. A slow warm glow and a slow mist drift, both transform and opacity only.
5. The existing content column, then the fixed navigation.

The HUD becomes a dark forest shelf and the nav becomes a forest shelf with
the active tab still on its violet plate. Home panels become dark forest glass
with a warm gold accent. Purple remains the interface accent on active tabs,
commander badges, deck cards, secondary deck actions and focus rings.

## Files

- `src/components/app/LobbyScene.tsx`: one optimized image plus the two
  atmospheric spans.
- `src/components/app/LobbyView.tsx`: mounts the scene in the ready lobby and
  passes the home HUD frame.
- `src/components/app/AppHud.tsx`: optional screen-specific class, used only by
  the lobby.
- `src/components/app/HomeSummary.module.css`: resource summary, metrics and
  account level move from solid violet to dark forest glass while keeping the
  gold, cyan and violet accents.
- `src/components/app/app.css`: the scenic layer, layer order, panel glass,
  commander wash, battle plate, HUD and nav frames, reduced-motion and calm
  fallbacks.
- `src/components/app/LobbyView.test.ts`: the scene appears only on the ready
  lobby and uses the soft world asset.

## Motion and performance

- One new image request. Next Image serves responsive WebP variants from the
  existing 2300x1400 source.
- No Phaser or WebGL instance, no second renderer, no full-viewport runtime
  blur, no animated background image and no particles.
- The two ambient layers animate only `transform` and `opacity`. They are
  removed under `prefers-reduced-motion` and when `calm` is true (reduced
  motion or Save-Data).
- The scene is fixed with a gradient fallback, so a late image never shifts
  layout.
- Card art remains lazy in the content layer above the world.
- The HUD's existing small backdrop blur is unchanged.

## Verification

Before and after captures are in
`ChogRoyale-Assets/next-pass-20261104/visual/lobby/before` and
`.../visual/lobby/after`, at 320x568, 375x667, 390x844, 430x932, 768x1024,
1366x768 and 1920x1080.

Recorded evidence:
- `before/results.json`: no scene, 0% green-dominant pixels, average RGB near
  purple, luminance 47.6 to 56.1.
- `after/results.json`: scene loaded at every viewport, 18.5% to 63.6%
  green-dominant pixels, average RGB moving to green and teal, luminance 55.7
  to 70.7. No horizontal overflow. Battle and navigation remain hit-testable.
- `after/motion-results.json`: normal motion runs the 16s glow and 26s mist;
  `calm` removes both. Reduced-motion captures remove both.
- `after/tour-results.json`: the real coach renders above the scene at 390x844
  and 1366x768, the spotlight still targets the real Decks nav tab, the nav
  remains clickable and Next/Back advance and return to the same step with no
  page errors.

Focused checks:
- `npx vitest run src/components/app/LobbyView.test.ts src/components/app/HomeSummary.test.ts`
- `npm run typecheck`
- scoped ESLint
- `npm run build`

## Limits

The browser evidence is a presentation fixture over the real lobby component
and real app CSS, not a live Privy account. Live authenticated acceptance and
a physical phone remain owner-gated. No migration, flag, reward, settlement or
tutorial rule was changed.
