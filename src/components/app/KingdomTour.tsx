"use client";

// "Meet Your Kingdom": a post-graduation, account-scoped guide over the real
// app. It lives in the shared /app layout so route changes never tear it down.
// The coach is deliberately non-modal: the highlighted control stays usable and
// Escape, Back, Skip and Finish all leave the player in control.

import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { KingdomTourCoach, KingdomTourInvite } from "./kingdom-tour-panels";
import { setKingdomTourActive } from "./kingdom-tour-active";
import { useMedia } from "@/components/site/use-media";
import {
  EMPTY_KINGDOM_TOUR,
  KINGDOM_TOUR_STEPS,
  KINGDOM_TOUR_TOTAL,
  coachPlacement,
  coachPosition,
  kingdomTourCanStart,
  kingdomTourInvite,
  kingdomTourKey,
  kingdomTourProgressionLine,
  kingdomTourRouteMatches,
  kingdomTourStepIndex,
  parseKingdomTour,
  type CoachPlacement,
  type KingdomTourProgress,
  type KingdomTourStepId,
  type KingdomTourStore,
  type ProgressionFacts,
} from "@/lib/kingdom-tour";

const INVITE_DELAY_MS = 1900;
const INVITE_BLOCKED_RETRY_MS = 600;
const CARD_WIDTH = 348;
const TARGET_RETRY_MS = 50;
const TARGET_RETRY_LIMIT = 200;
const ROUTE_PUSH_TIMEOUT_MS = 4000;
const SHEET_CLOSE_SELECTOR = '[data-tour="card-detail-close"]';
const COLLECTION_TAB_SELECTOR = "#app-tab-collection";
const COLLECTION_CARD_SELECTOR = '[data-tour="collection-card"]';
const PROGRESS_SELECTOR = '[data-tour="card-progress"]';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Viewport {
  width: number;
  height: number;
  navHeight: number;
  safeTop: number;
  safeLeft: number;
  safeRight: number;
}

const EMPTY_VIEWPORT: Viewport = { width: 0, height: 0, navHeight: 0, safeTop: 0, safeLeft: 0, safeRight: 0 };

function isVisibleElement(node: Element | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const box = node.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && node.getClientRects().length > 0;
}

/**
 * Cache Components keeps hidden routes mounted, so a global selector can match
 * a control on a page the player cannot see. Every lookup goes through this.
 */
function visibleElement(selector: string): HTMLElement | null {
  for (const node of Array.from(document.querySelectorAll(selector))) {
    if (isVisibleElement(node)) return node;
  }
  return null;
}

function visibleNavHeight(): number {
  const nav = visibleElement(".app-nav");
  return nav ? nav.getBoundingClientRect().height : 0;
}

function readSafeArea(): Pick<Viewport, "safeTop" | "safeLeft" | "safeRight"> {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top,0px);padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);visibility:hidden;pointer-events:none;";
  document.body.appendChild(probe);
  try {
    const style = window.getComputedStyle(probe);
    return {
      safeTop: Number.parseFloat(style.paddingTop) || 0,
      safeLeft: Number.parseFloat(style.paddingLeft) || 0,
      safeRight: Number.parseFloat(style.paddingRight) || 0,
    };
  } finally {
    probe.remove();
  }
}

function readViewport(): Viewport {
  const safe = readSafeArea();
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    navHeight: visibleNavHeight(),
    ...safe,
  };
}

function sameViewport(a: Viewport, b: Viewport): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.navHeight === b.navHeight &&
    a.safeTop === b.safeTop &&
    a.safeLeft === b.safeLeft &&
    a.safeRight === b.safeRight
  );
}

function readStore(playerId: string): KingdomTourStore {
  if (!playerId || typeof window === "undefined") return { ...EMPTY_KINGDOM_TOUR };
  try {
    return parseKingdomTour(window.localStorage.getItem(kingdomTourKey(playerId)));
  } catch {
    return { ...EMPTY_KINGDOM_TOUR };
  }
}

/** Only authenticated players mount the guide, so it can read account state
 * once per sign-in without a render-time fetch or a hydration mismatch. */
export default function KingdomTour() {
  const { ready, authenticated, user } = usePrivy();
  if (!ready || !authenticated) return null;
  const playerId = user?.id ?? "";
  if (!playerId) return null;
  return <KingdomTourController key={playerId} playerId={playerId} />;
}

function KingdomTourController({ playerId }: { playerId: string }) {
  const { getAccessToken } = usePrivy();
  const pathname = usePathname();
  const router = useRouter();

  const [store, setStore] = useState<KingdomTourStore>(() => readStore(playerId));
  const [progress, setProgress] = useState<KingdomTourProgress | null>(null);
  const [active, setActive] = useState(() => store.active);
  const [stepIndex, setStepIndex] = useState(() => kingdomTourStepIndex(store.stepId));
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [placement, setPlacement] = useState<CoachPlacement>("center");
  const [cardHeight, setCardHeight] = useState(196);
  const [progressionLine, setProgressionLine] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>(EMPTY_VIEWPORT);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");

  const cardRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const focusCapturedRef = useRef(false);
  const progressRef = useRef<KingdomTourProgress | null>(null);
  const fetchedOnceRef = useRef(false);
  const refreshAfterBattleRef = useRef(false);
  const pendingRouteRef = useRef<string | null>(null);
  const openedSheetStepRef = useRef<KingdomTourStepId | null>(null);
  const scrolledStepRef = useRef<KingdomTourStepId | null>(null);
  const resumeAttemptedRef = useRef(false);
  const focusAfterLobbyRef = useRef(false);

  const battleRoute = pathname.includes("/battle");
  const tourVisible = active && !battleRoute;
  const step = KINGDOM_TOUR_STEPS[stepIndex] ?? KINGDOM_TOUR_STEPS[0]!;

  // A card sheet is non-modal while the tour explains it.
  useEffect(() => {
    setKingdomTourActive(tourVisible);
    return () => setKingdomTourActive(false);
  }, [tourVisible]);

  // The Profile replay action only appears for an account the server allows to
  // start the tour. Only a readiness flag reaches the DOM, never a stage count.
  useEffect(() => {
    if (kingdomTourCanStart(progress)) document.documentElement.dataset.kingdomTour = "ready";
    else delete document.documentElement.dataset.kingdomTour;
    return () => {
      delete document.documentElement.dataset.kingdomTour;
    };
  }, [progress]);

  // Server-owned eligibility. A 3/3 read is the only graduation signal; local
  // storage never decides whether a player graduated. The read happens once,
  // then again after a battle because a battle can graduate the account. It
  // does not follow every tab change.
  useEffect(() => {
    if (battleRoute) {
      refreshAfterBattleRef.current = true;
      return;
    }
    if (fetchedOnceRef.current && !refreshAfterBattleRef.current) return;
    const known = progressRef.current;
    if (known && (known.completedStages >= 3 || known.grandfathered)) {
      fetchedOnceRef.current = true;
      refreshAfterBattleRef.current = false;
      return;
    }
    refreshAfterBattleRef.current = false;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) {
          if (!cancelled) fetchedOnceRef.current = false;
          return;
        }
        const response = await fetch("/api/players/me/tutorial", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const body = (await response.json().catch(() => null)) as
          | { success?: boolean; data?: { tutorial?: { completedStages?: number; grandfathered?: boolean } } }
          | null;
        const tutorial = response.ok && body?.success ? body.data?.tutorial : null;
        if (cancelled) return;
        const next =
          tutorial && typeof tutorial.completedStages === "number"
            ? { completedStages: tutorial.completedStages, grandfathered: tutorial.grandfathered === true }
            : null;
        progressRef.current = next;
        setProgress(next);
        fetchedOnceRef.current = next !== null;
      } catch {
        if (!cancelled) {
          progressRef.current = null;
          setProgress(null);
          fetchedOnceRef.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [battleRoute, getAccessToken, playerId]);

  const saveStore = useCallback((update: (prev: KingdomTourStore) => KingdomTourStore) => {
    setStore(update);
  }, []);

  // Persist outside the state updater so React can run the updater twice in
  // development without duplicating side effects.
  useEffect(() => {
    try {
      window.localStorage.setItem(kingdomTourKey(playerId), JSON.stringify(store));
    } catch {
      /* private mode: the tour still works for this tab */
    }
  }, [playerId, store]);

  const closeSheet = useCallback(() => {
    visibleElement(SHEET_CLOSE_SELECTOR)?.click();
  }, []);

  const focusAfterTour = useCallback(() => {
    const origin = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (origin?.isConnected) {
      origin.focus({ preventScroll: true });
      return;
    }
    const activeTab = visibleElement('.app-nav [aria-current="page"]');
    (activeTab ?? visibleElement(".app-nav a"))?.focus({ preventScroll: true });
  }, []);

  const routeTo = useCallback(
    (route: string) => {
      if (kingdomTourRouteMatches(pathname, route)) return;
      pendingRouteRef.current = route;
      router.push(route);
      window.setTimeout(() => {
        if (pendingRouteRef.current === route) pendingRouteRef.current = null;
      }, ROUTE_PUSH_TIMEOUT_MS);
    },
    [pathname, router],
  );

  const leaveTour = useCallback(
    (remember: "dismiss" | "pause" | "complete") => {
      closeSheet();
      setActive(false);
      setInviteOpen(false);
      setRect(null);
      setProgressionLine(null);
      saveStore((prev) => ({
        ...prev,
        active: false,
        stepId: null,
        prompted: true,
        dismissed: remember === "dismiss" ? true : prev.dismissed,
        completed: remember === "complete" ? true : prev.completed,
      }));
      if (remember === "complete" && !kingdomTourRouteMatches(pathname, "/app")) {
        focusAfterLobbyRef.current = true;
        routeTo("/app");
        return;
      }
      focusAfterTour();
    },
    [closeSheet, focusAfterTour, pathname, routeTo, saveStore],
  );

  const startTour = useCallback(() => {
    closeSheet();
    setInviteOpen(false);
    setRect(null);
    setProgressionLine(null);
    openedSheetStepRef.current = null;
    scrolledStepRef.current = null;
    resumeAttemptedRef.current = true;
    restoreFocusRef.current = null;
    setStepIndex(0);
    setActive(true);
    saveStore((prev) => ({ ...prev, active: true, stepId: KINGDOM_TOUR_STEPS[0]!.id, prompted: true }));
    routeTo(KINGDOM_TOUR_STEPS[0]!.route);
  }, [closeSheet, routeTo, saveStore]);

  const go = useCallback(
    (direction: 1 | -1) => {
      const current = KINGDOM_TOUR_STEPS[stepIndex];
      const nextIndex = stepIndex + direction;
      if (!current || nextIndex < 0) return;
      if (nextIndex >= KINGDOM_TOUR_TOTAL) {
        leaveTour("complete");
        return;
      }
      const next = KINGDOM_TOUR_STEPS[nextIndex]!;
      if (next.id !== "card-upgrades") closeSheet();
      openedSheetStepRef.current = null;
      scrolledStepRef.current = null;
      setRect(null);
      setProgressionLine(null);
      setStepIndex(nextIndex);
      saveStore((prev) => ({ ...prev, active: true, stepId: next.id, prompted: true }));
      routeTo(next.route);
    },
    [closeSheet, leaveTour, routeTo, saveStore, stepIndex],
  );

  // Resuming a saved tour returns to its route once. After that, a manual tab
  // change pauses the tour instead of pulling the player back.
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    if (!active || battleRoute) return;
    resumeAttemptedRef.current = true;
    const route = KINGDOM_TOUR_STEPS[stepIndex]?.route;
    if (route) routeTo(route);
  }, [active, battleRoute, routeTo, stepIndex]);

  useEffect(() => {
    if (!tourVisible) return;
    const pending = pendingRouteRef.current;
    if (pending) {
      if (pending === step.route) {
        if (!kingdomTourRouteMatches(pathname, step.route)) return;
        pendingRouteRef.current = null;
      } else {
        pendingRouteRef.current = null;
      }
    }
    if (!kingdomTourRouteMatches(pathname, step.route)) {
      const timer = window.setTimeout(() => leaveTour("pause"), 0);
      return () => window.clearTimeout(timer);
    }
  }, [leaveTour, pathname, step.route, tourVisible]);

  useEffect(() => {
    if (focusAfterLobbyRef.current && kingdomTourRouteMatches(pathname, "/app")) {
      focusAfterLobbyRef.current = false;
      focusAfterTour();
    }
  }, [focusAfterTour, pathname]);

  // Invitation: only after the branded opening has cleared, only for a
  // server-verified 3/3 account, and only once. It appears in the lobby and in
  // the Battle Hall, the two places a fresh graduate naturally lands.
  useEffect(() => {
    if (inviteOpen || active || battleRoute) return;
    if (!kingdomTourRouteMatches(pathname, "/app") && !kingdomTourRouteMatches(pathname, "/app/play")) return;
    if (!kingdomTourInvite(progress, store)) return;
    let cancelled = false;
    let timer = 0;
    const attempt = () => {
      if (cancelled) return;
      if (visibleElement("dialog[data-app-opening][open]")) {
        timer = window.setTimeout(attempt, INVITE_BLOCKED_RETRY_MS);
        return;
      }
      setInviteOpen(true);
      saveStore((prev) => ({ ...prev, prompted: true }));
    };
    timer = window.setTimeout(attempt, INVITE_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, battleRoute, inviteOpen, pathname, progress, saveStore, store]);

  // Leaving the two invitation routes or entering a battle closes the prompt.
  useEffect(() => {
    if (!inviteOpen) return;
    if (kingdomTourRouteMatches(pathname, "/app") || kingdomTourRouteMatches(pathname, "/app/play")) return;
    const timer = window.setTimeout(() => setInviteOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [inviteOpen, pathname]);

  useEffect(() => {
    if (!inviteOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInviteOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [inviteOpen]);

  // Manual reopen from Profile or any future surface.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("[data-tour-start]") : null;
      if (!target) return;
      event.preventDefault();
      if (!kingdomTourCanStart(progressRef.current)) return;
      startTour();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [startTour]);

  // Escape pauses without marking the tour complete or dismissed.
  useEffect(() => {
    if (!tourVisible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      leaveTour("pause");
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [leaveTour, tourVisible]);

  // Measure the coach so placement stays inside the viewport and above the nav.
  useLayoutEffect(() => {
    if (!tourVisible) return;
    const node = cardRef.current;
    if (!node) return;
    const update = () => setCardHeight((prev) => (prev === node.offsetHeight ? prev : node.offsetHeight));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [progressionLine, stepIndex, tourVisible]);

  useEffect(() => {
    const update = () =>
      setViewport((prev) => {
        const next = readViewport();
        return sameViewport(prev, next) ? prev : next;
      });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  // Find the real target, open the real card sheet when the lesson calls for
  // it, and keep the spotlight on the element as the page settles.
  useEffect(() => {
    if (!tourVisible) return;
    let cancelled = false;
    let timer = 0;
    let attempts = 0;
    let element: HTMLElement | null = null;

    const measure = () => {
      if (cancelled || !element) return;
      const box = element.getBoundingClientRect();
      const next = { left: box.left, top: box.top, width: box.width, height: box.height };
      setRect((prev) =>
        prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height
          ? prev
          : next,
      );
      const navHeight = visibleNavHeight();
      setPlacement(coachPlacement(box, window.innerHeight, cardHeight, navHeight + 16));
      setViewport((prev) => (prev.navHeight === navHeight ? prev : { ...prev, navHeight }));
    };

    const readProgression = () => {
      const block = visibleElement(PROGRESS_SELECTOR);
      if (!block) {
        setProgressionLine(null);
        return;
      }
      const facts: ProgressionFacts = {
        state: block.dataset.state ?? "",
        level: block.dataset.level ?? "",
        xp: block.dataset.xp ?? "",
        xpTarget: block.dataset.xpTarget ?? "",
        gold: block.dataset.gold ?? "",
        status: block.dataset.status ?? "",
      };
      setProgressionLine(kingdomTourProgressionLine(facts));
    };

    const prepareContext = () => {
      if (step.id === "card-detail") {
        if (!visibleElement(COLLECTION_CARD_SELECTOR)) visibleElement(COLLECTION_TAB_SELECTOR)?.click();
        return;
      }
      if (step.id !== "card-upgrades") return;
      if (visibleElement(PROGRESS_SELECTOR)) return;
      if (!visibleElement(COLLECTION_CARD_SELECTOR)) {
        visibleElement(COLLECTION_TAB_SELECTOR)?.click();
        return;
      }
      if (openedSheetStepRef.current !== step.id) {
        openedSheetStepRef.current = step.id;
        visibleElement(COLLECTION_CARD_SELECTOR)?.click();
      }
    };

    const find = () => {
      if (cancelled) return;
      prepareContext();
      const found = visibleElement(step.target);
      if (found) {
        element = found;
        const box = found.getBoundingClientRect();
        const offscreen = box.top < 8 || box.bottom > window.innerHeight - 8;
        if (offscreen && scrolledStepRef.current !== step.id) {
          scrolledStepRef.current = step.id;
          found.scrollIntoView({ block: "center", inline: "center", behavior: reduced ? "auto" : "smooth" });
        }
        if (step.id === "card-upgrades") readProgression();
        measure();
        return;
      }
      if (attempts < TARGET_RETRY_LIMIT) {
        attempts += 1;
        timer = window.setTimeout(find, TARGET_RETRY_MS);
      }
    };

    find();

    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    const poll = window.setInterval(() => {
      if (!element) return;
      if (document.contains(element) && isVisibleElement(element)) {
        if (step.id === "card-upgrades") readProgression();
        measure();
      } else {
        element = null;
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [cardHeight, pathname, reduced, step.id, step.target, tourVisible]);

  const coachWidth = useMemo(() => {
    const width = viewport.width > 0 ? viewport.width : 360;
    const available = width - 24 - viewport.safeLeft - viewport.safeRight;
    return Math.max(260, Math.min(CARD_WIDTH, available));
  }, [viewport]);

  // Keep the coach inside the viewport and above the fixed navigation.
  const position = useMemo(
    () =>
      coachPosition({
        rect,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        cardHeight,
        coachWidth,
        navHeight: viewport.navHeight,
        safeTop: viewport.safeTop,
        safeLeft: viewport.safeLeft,
        safeRight: viewport.safeRight,
        placement,
      }),
    [cardHeight, coachWidth, placement, rect, viewport],
  );

  // Capture the origin once, before the coach takes focus, so a step change can
  // never mistake the coach itself for the element to return to.
  useEffect(() => {
    if (!tourVisible) {
      focusCapturedRef.current = false;
      return;
    }
    if (focusCapturedRef.current) return;
    focusCapturedRef.current = true;
    const origin = document.activeElement;
    if (origin instanceof HTMLElement && origin !== document.body) restoreFocusRef.current = origin;
  }, [tourVisible]);

  // Move focus into the coach on every step, and return it to the page on exit.
  useEffect(() => {
    if (!tourVisible) return;
    const frame = window.requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [stepIndex, tourVisible]);

  return (
    <>
      {inviteOpen && !tourVisible && (
        <KingdomTourInvite onStart={startTour} onDismiss={() => leaveTour("dismiss")} />
      )}
      {tourVisible && (
        <KingdomTourCoach
          step={step}
          stepIndex={stepIndex}
          total={KINGDOM_TOUR_TOTAL}
          placement={placement}
          left={position.left}
          top={position.top}
          width={coachWidth}
          spotlight={rect}
          reduced={reduced}
          progressionLine={progressionLine}
          cardRef={cardRef}
          onNext={() => go(1)}
          onBack={() => go(-1)}
          onSkip={() => leaveTour("dismiss")}
          onClose={() => leaveTour("pause")}
        />
      )}
    </>
  );
}
