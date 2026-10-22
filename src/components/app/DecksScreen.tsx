"use client";

// Decks and collection screen (A2).
//
// This file owns the session, the network and the deck draft. It reads the
// real player, loadout and commander endpoints, turns them into plain props and
// hands them to DecksView. The view stays free of tokens, fetch calls and
// Privy, so it can also be rendered from a preview or a test.
//
// The account deck is only ever written through the existing authenticated
// PUT endpoint. When that service is unavailable the deck stays an unsaved
// local draft and the screen says so instead of claiming a save.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import DecksView from "./DecksView";
import { useLobbyCatalog } from "./catalog-context";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import type { LobbyPlayer } from "./lobby-types";
import {
  CHOG_GENESIS_CHAIN_ID,
  CHOG_GENESIS_CONTRACT,
  COMMANDER_CLASS_CHOICES,
  commanderChoiceSchema,
  type CommanderChoice,
} from "@/lib/battle-protocol";
import { LOADOUT_SCHEMA_VERSION, chooseInitialLoadout, type SavedLoadout } from "@/lib/loadout";
import {
  DECK_CARD_COUNT,
  addCard,
  allOrdinaryCards,
  averageEnergyCost,
  cardAction,
  commanderCostFor,
  deckSaveState,
  filterCards,
  removeCard,
  replaceCard,
  saveStateLabel,
  validateDeckDraft,
  type DeckDraft,
} from "./decks-model";import type {
  CardCostFilter,
  CardRoleFilter,
  CommanderChoiceLike,
  DecksCatalogCard,
  DecksCommanderOption,
  DecksNotices,
  DecksTab,
} from "./decks-types";
import { useMedia, useSaveData } from "@/components/site/use-media";

/** The local draft key. A convenience store on this device, never an account. */
const DRAFT_KEY = "chog.a2.deckDraft";

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: { loadout?: SavedLoadout | null; invalidSaved?: { revision: number; reason: string } };
  };
}

interface LoadoutPayload {
  loadout: SavedLoadout | null;
  invalidSaved?: { revision: number; reason: string };
}

interface CommandersPayload {
  nftCommanders: Array<{
    tokenId: string;
    name: string | null;
    status: string;
    eligible: boolean;
    reason?: string;
    commander?: { class: string; variant: string; prestige: string } | null;
  }>;
  freeCommanders: Array<{ id: string; name: string; class: string }>;
  rulesetVersion: string;
  freshness?: string;
}

interface ApiError {
  code: string;
  message: string;
  bootstrap?: boolean;
}

type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string; bootstrap?: boolean };

async function getJson<T>(path: string, token: string): Promise<Result<T>> {
  try {
    const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as Envelope<T>;
    if (body.success && body.data !== undefined) return { ok: true, data: body.data };
    return {
      ok: false,
      code: body.error?.code ?? "REQUEST_FAILED",
      message: body.error?.message ?? `The server answered ${res.status}.`,
      bootstrap: false,
    };
  } catch {
    return { ok: false, code: "NETWORK", message: "The deck screen could not reach the server." };
  }
}

function readLocalDraft(): DeckDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cards?: unknown; commander?: unknown };
    if (!Array.isArray(parsed.cards)) return null;
    // The stored claim is re-checked with the same schema the server uses, so a
    // stale or hand-edited value can never come back as a valid claim.
    const claim = commanderChoiceSchema.safeParse(parsed.commander);
    if (!claim.success) return null;
    return {
      cards: parsed.cards.filter((c): c is string => typeof c === "string"),
      commander: claim.data,
    };
  } catch {
    return null;
  }
}

function writeLocalDraft(draft: DeckDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage can be blocked or full. The draft still lives in memory for this
    // visit, and the screen never claims it was stored.
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function DecksShell() {
  const catalog = useLobbyCatalog();
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { login } = useLogin();

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [profileError, setProfileError] = useState<ApiError | null>(null);
  const [loadout, setLoadout] = useState<LoadoutPayload | null>(null);
  const [loadoutError, setLoadoutError] = useState<ApiError | null>(null);
  const [commanders, setCommanders] = useState<CommandersPayload | null>(null);
  const [commandersError, setCommandersError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState<DecksTab>("deck");
  const [roleFilter, setRoleFilter] = useState<CardRoleFilter>("all");
  const [costFilter, setCostFilter] = useState<CardCostFilter>("all");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [commanderOpen, setCommanderOpen] = useState(false);
  const [swapping, setSwapping] = useState(false);

  // The draft starts empty on both the server and the client, so the first
  // render matches the server HTML. The account copy and the local draft are
  // applied once the reads resolve, after hydration.
  const [draft, setDraft] = useState<DeckDraft>({ cards: [], commander: { kind: "free", class: "scout" } });
  /** True when the deck on screen is also remembered on this device. */
  const [localDraft, setLocalDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ revision: number; cards: string[]; commander: CommanderChoiceLike } | null>(null);

  /** Edits made before the account copy arrives must not be clobbered. */
  const touched = useRef(false);
  const sessionKey = user?.id ?? null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const saveData = useSaveData();
  const calm = reducedMotion || saveData;

  const load = useCallback(async () => {
    const token = await getAccessToken();
    setBusy(true);
    try {
      if (!token) {
        setProfile(null);
        setProfileError({ code: "UNAUTHORIZED", message: "Sign in to open your deck." });
        return;
      }
      const [profileResult, loadoutResult, commandersResult] = await Promise.all([
        // GET /api/players/me nests the profile under data.player, unlike the
        // loadout and commander reads which answer with their payload directly.
        getJson<{ player: ProfilePayload }>("/api/players/me", token),
        getJson<LoadoutPayload>("/api/players/me/loadout", token),
        getJson<CommandersPayload>("/api/players/me/commanders", token),
      ]);

      if (profileResult.ok) {
        setProfile(profileResult.data.player);
        setProfileError(null);
      } else {
        setProfile(null);
        setProfileError({ code: profileResult.code, message: profileResult.message });
      }

      if (loadoutResult.ok) {
        setLoadout(loadoutResult.data);
        setLoadoutError(null);
      } else {
        setLoadout(null);
        setLoadoutError({ code: loadoutResult.code, message: loadoutResult.message });
      }

      if (commandersResult.ok) {
        setCommanders(commandersResult.data);
        setCommandersError(null);
      } else {
        setCommanders(null);
        setCommandersError({ code: commandersResult.code, message: commandersResult.message });
      }

      if (loadoutResult.ok && !touched.current) {
        // The account copy always wins. The local draft is only the fallback
        // when the account holds no deck.
        const pick = chooseInitialLoadout({
          server: loadoutResult.data.loadout,
          serverInvalid: Boolean(loadoutResult.data.invalidSaved),
          localDraft: typeof window === "undefined" ? null : readLocalDraft(),
          presets: {},
        });
        const cards = pick.cards.filter((id) => Boolean(catalog.cards[id]));
        setDraft({ cards, commander: pick.commander as CommanderChoice });
        setLocalDraft(pick.source === "local-draft");
      }
    } finally {
      setBusy(false);
      setLoadedFor(sessionKey);
    }
  }, [getAccessToken, catalog, sessionKey]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    // The reads start on the next tick, so the effect body itself never sets
    // state and the first render of a new session stays on the loading gate.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [ready, authenticated, load]);

  const player: LobbyPlayer | null = useMemo(() => (profile ? resolvePlayer(profile) : null), [profile]);

  const allCards = useMemo(() => allOrdinaryCards(catalog), [catalog]);
  const visibleCards = useMemo(() => filterCards(allCards, roleFilter, costFilter), [allCards, roleFilter, costFilter]);

  const serverDeck: SavedLoadout | null = loadout?.loadout ?? null;

  // The commander the deck is playing with, resolved from the claim.
  const nftClassOf = useCallback(
    (tokenId: string): string | null => {
      const entry = commanders?.nftCommanders.find((n) => n.tokenId === tokenId);
      return entry?.commander?.class ?? null;
    },
    [commanders]
  );

  const commanderOptions = useMemo<DecksCommanderOption[]>(() => {
    const options: DecksCommanderOption[] = catalog.commanders.map((c) => ({
      key: `free:${c.classId}`,
      kind: "free",
      classId: c.classId,
      className: c.className,
      displayName: c.freeName,
      tokenId: null,
      cost: c.cost,
      art: c.commanderCardArt,
      stats: c.stats,
      blockedReason: null,
      artNote: `${c.className} class art, shared by every ${c.className} commander. It is not a specific NFT.`,
    }));
    for (const nft of commanders?.nftCommanders ?? []) {
      const cls = nft.commander?.class ?? null;
      const className = cls ? titleCase(cls) : "Unknown";
      const usable = nft.status === "derived" && nft.eligible && cls !== null;
      const classEntry = cls ? catalog.commanders.find((c) => c.classId === cls) : undefined;
      options.push({
        key: `nft:${nft.tokenId}`,
        kind: "nft",
        classId: cls ?? "",
        className,
        displayName: nft.name ?? `Chog Genesis #${nft.tokenId}`,
        tokenId: nft.tokenId,
        cost: classEntry?.cost ?? null,
        art: classEntry?.commanderCardArt ?? null,
        stats: classEntry?.stats ?? [],
        blockedReason: usable
          ? null
          : (nft.reason ?? (nft.eligible ? "This token has no derived commander yet." : "No verified linked wallet holds this token right now.")),
        artNote: `${className} class art, shared by every ${className} commander. It is not a specific NFT. The battle server proves ownership again when you ready up and again at match start.`,
      });
    }
    return options;
  }, [catalog, commanders]);

  const commanderOption = useMemo<DecksCommanderOption | null>(() => {
    const claim = draft.commander;
    if (claim.kind === "free") {
      return commanderOptions.find((o) => o.kind === "free" && o.classId === claim.class) ?? null;
    }
    return commanderOptions.find((o) => o.kind === "nft" && o.tokenId === claim.tokenId) ?? null;
  }, [commanderOptions, draft.commander]);

  const commanderCost = useMemo(() => {
    const claim = draft.commander;
    if (claim.kind === "free") return commanderCostFor(catalog, claim);
    const cls = nftClassOf(claim.tokenId);
    if (!cls) return null;
    return catalog.commanders.find((c) => c.classId === cls)?.cost ?? null;
  }, [catalog, draft.commander, nftClassOf]);

  const averageCost = useMemo(
    () => averageEnergyCost(catalog, draft.cards, commanderCost),
    [catalog, draft.cards, commanderCost]
  );

  const deckProblems = useMemo(() => validateDeckDraft(catalog, draft.cards), [catalog, draft.cards]);

  const updateDraft = useCallback((next: DeckDraft) => {
    touched.current = true;
    setDraft(next);
    setLocalDraft(true);
    writeLocalDraft(next);
  }, []);

  const onDeckSlot = useCallback(
    (slot: number) => {
      if (swapping) {
        // A card picked from the collection is waiting for a slot.
        const incoming = selectedCardId;
        setSwapping(false);
        setSelectedCardId(null);
        if (incoming) updateDraft({ ...draft, cards: replaceCard(draft.cards, slot, incoming) });
        return;
      }
      const id = draft.cards[slot];
      if (!id) return;
      setSelectedCardId(id);
    },
    [draft, swapping, selectedCardId, updateDraft]
  );

  const onCardAction = useCallback(
    (cardId: string) => {
      const action = cardAction(draft.cards, cardId);
      if (action.kind === "remove") {
        updateDraft({ ...draft, cards: removeCard(draft.cards, cardId) });
        setSelectedCardId(null);
        setSwapping(false);
        return;
      }
      if (action.kind === "add") {
        updateDraft({ ...draft, cards: addCard(draft.cards, cardId) });
        setSelectedCardId(null);
        return;
      }
      // The deck is full: the player picks the slot to replace. The deck grid
      // is on the other tab, so the screen moves there to show the targets.
      setSwapping(true);
      setTab("deck");
    },
    [draft, updateDraft]
  );

  const onSelectCommander = useCallback(
    (option: DecksCommanderOption) => {
      if (option.blockedReason) return;
      if (option.kind === "free") {
        if (!(COMMANDER_CLASS_CHOICES as readonly string[]).includes(option.classId)) return;
        updateDraft({
          ...draft,
          commander: { kind: "free", class: option.classId as (typeof COMMANDER_CLASS_CHOICES)[number] },
        });
      } else {
        const tokenId = option.tokenId ?? "";
        if (!/^\d{1,78}$/.test(tokenId)) return;
        updateDraft({
          ...draft,
          commander: {
            kind: "nft",
            chainId: CHOG_GENESIS_CHAIN_ID,
            contract: CHOG_GENESIS_CONTRACT,
            tokenId,
          },
        });
      }
      setCommanderOpen(false);
    },
    [draft, updateDraft]
  );

  const save = useCallback(
    async (expectedRevision: number | null) => {
      setSaving(true);
      setSaveError(null);
      setConflict(null);
      try {
        const token = await getAccessToken();
        if (!token) {
          setSaveError("Your session is no longer valid. Sign in again to save your deck.");
          return;
        }
        const res = await fetch("/api/players/me/loadout", {
          method: "PUT",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: LOADOUT_SCHEMA_VERSION,
            cards: draft.cards,
            commander: draft.commander,
            expectedRevision,
          }),
        });
        const body = (await res.json()) as Envelope<{ loadout: SavedLoadout }>;
        if (res.status === 409) {
          const current = body.error?.details?.loadout ?? null;
          setConflict(
            current
              ? { revision: current.revision, cards: current.cards, commander: current.commander }
              : { revision: expectedRevision ?? 0, cards: [], commander: { kind: "free", class: "scout" } }
          );
          return;
        }
        if (!body.success || !body.data?.loadout) {
          setSaveError(body.error?.message ?? `The server answered ${res.status}. Your deck is kept on this device.`);
          return;
        }
        setLoadout({ loadout: body.data.loadout });
        setSaveError(null);
      } catch {
        setSaveError("The deck could not be saved. Your draft is kept on this device.");
      } finally {
        setSaving(false);
      }
    },
    [draft, getAccessToken]
  );

  const onSave = useCallback(() => {
    void save(serverDeck?.revision ?? loadout?.invalidSaved?.revision ?? null);
  }, [save, serverDeck?.revision, loadout?.invalidSaved?.revision]);

  const onLoadAccountDeck = useCallback(() => {
    if (!conflict) return;
    const cards = conflict.cards.filter((id) => Boolean(catalog.cards[id]));
    const next: DeckDraft = { cards, commander: conflict.commander as CommanderChoice };
    touched.current = true;
    setDraft(next);
    writeLocalDraft(next);
    setConflict(null);
    setSaveError(null);
  }, [conflict, catalog]);

  const onOverwriteAccountDeck = useCallback(() => {
    if (!conflict) return;
    void save(conflict.revision);
  }, [conflict, save]);

  // The account service being unreachable is not the same as an empty account.
  const unavailable = Boolean(loadoutError) && loadoutError?.code !== "FORBIDDEN" && loadoutError?.code !== "UNAUTHORIZED";
  const saveState = deckSaveState({
    loading: loadout === null && !loadoutError,
    unavailable,
    serverCards: serverDeck?.cards ?? null,
    serverCommander: (serverDeck?.commander as CommanderChoiceLike) ?? null,
    draft,
    hasSavedDeck: Boolean(serverDeck) || Boolean(loadout?.invalidSaved),
    saveFailed: Boolean(saveError),
    conflict: Boolean(conflict),
  });

  const deckCards = useMemo<(DecksCatalogCard | null)[]>(
    () =>
      Array.from({ length: DECK_CARD_COUNT }, (_, i) => {
        const id = draft.cards[i];
        if (!id) return null;
        const card = catalog.cards[id];
        return card ? ({ ...card } as DecksCatalogCard) : null;
      }),
    [draft.cards, catalog]
  );

  const invalidSaved = loadout?.invalidSaved ?? null;
  const commanderClaim = draft.commander;

  const notices = useMemo<DecksNotices[]>(() => {
    const list: DecksNotices[] = [];
    if (loadoutError) {
      if (loadoutError.code === "FORBIDDEN") {
        list.push({ tone: "warn", text: "Your saved deck unlocks once your profile setup is complete." });
      } else if (loadoutError.code === "INTERNAL_ERROR" || loadoutError.code === "SERVICE_UNAVAILABLE") {
        list.push({ tone: "warn", text: "The deck service is not available right now, so your account deck cannot be read or written. You can still build a deck here; it stays on this device until the service is back." });
      } else if (loadoutError.code === "UNAUTHORIZED") {
        list.push({ tone: "error", text: "Your session is no longer valid. Sign in again to open your deck." });
      } else {
        list.push({ tone: "error", text: `Your saved deck could not be read. ${loadoutError.message}` });
      }
    }
    if (invalidSaved) {
      list.push({ tone: "warn", text: `The saved deck is no longer valid and cannot be used: ${invalidSaved.reason}.` });
    }
    if (commandersError) {
      list.push({ tone: "warn", text: `Commander eligibility could not be read. ${commandersError.message}` });
    }
    if (profile && !profile.onboarding.complete) {
      list.push({ tone: "info", text: "Your profile setup is not finished, so the saved deck stays locked until it is." });
    }
    if (commanderClaim.kind === "nft" && commanderOption?.blockedReason) {
      list.push({ tone: "warn", text: `Token ${commanderClaim.tokenId} is claimed as your commander, but a linked wallet does not prove you hold it right now. The battle server checks ownership when you ready up and again at match start.` });
    }
    return list;
  }, [loadoutError, invalidSaved, commandersError, profile, commanderClaim, commanderOption]);

  const loaded = authenticated && sessionKey !== null && loadedFor === sessionKey;

  const phase: "booting" | "login" | "profile" | "ready" = !ready
    ? "booting"
    : !authenticated
      ? "login"
      : !loaded
        ? "booting"
        : profileError || !profile
          ? "profile"
          : "ready";

  const status = useMemo(() => {
    const parts: string[] = [];
    parts.push(`Deck on screen: ${draft.cards.length} of ${DECK_CARD_COUNT} ordinary cards.`);
    parts.push(averageCost !== null ? `Average energy cost ${averageCost}.` : "Average energy cost is not set yet.");
    parts.push(
      saveState === "saved"
        ? "Saved to your account."
        : saveState === "unsaved"
          ? "Unsaved changes on this device."
          : saveState === "unavailable"
            ? "The deck service is not available, so this deck is only on this device."
            : saveState === "conflict"
              ? "Your account deck changed elsewhere. Choose which deck to keep."
              : saveState === "save-failed"
                ? "The last save failed. Your draft is kept on this device."
                : "Reading your saved deck."
    );
    if (busy) parts.push("Refreshing.");
    return parts.join(" ");
  }, [draft.cards.length, averageCost, saveState, busy]);

  const canSave =
    saveState !== "loading" &&
    saveState !== "saved" &&
    !unavailable &&
    deckProblems.length === 0 &&
    draft.cards.length === DECK_CARD_COUNT &&
    !saving;

  return (
    <DecksView
      phase={phase}
      player={player}
      tab={tab}
      onTabChange={setTab}
      cards={allCards}
      visibleCards={visibleCards}
      roleFilter={roleFilter}
      costFilter={costFilter}
      costs={[...new Set(allCards.map((c) => c.cost))].sort((a, b) => a - b)}
      onRoleFilter={setRoleFilter}
      onCostFilter={setCostFilter}
      deckCards={deckCards}
      swapping={swapping}
      deckProblems={deckProblems}
      averageCost={averageCost}
      onDeckSlot={onDeckSlot}
      onCancelSwap={() => {
        setSwapping(false);
        setSelectedCardId(null);
      }}
      commanderOption={commanderOption}
      commanderOptions={commanderOptions}
      onSelectCommander={onSelectCommander}
      selectedCardId={selectedCardId}
      commanderOpen={commanderOpen}
      onSelectCard={(id) => {
        setSwapping(false);
        setSelectedCardId(id);
      }}
      onOpenCommander={() => {
        setSwapping(false);
        setCommanderOpen(true);
      }}
      onCloseDetail={() => {
        setSelectedCardId(null);
        setCommanderOpen(false);
        setSwapping(false);
      }}
      onCardAction={onCardAction}
      saveState={saveState}
      saveLabel={saveStateLabel(saveState, serverDeck?.revision ?? null)}
      revision={serverDeck?.revision ?? null}
      saving={saving}
      canSave={canSave}
      saveError={saveError}
      conflict={conflict}
      onSave={onSave}
      onLoadAccountDeck={onLoadAccountDeck}
      onOverwriteAccountDeck={onOverwriteAccountDeck}
      unavailable={unavailable}
      localDraft={localDraft}
      notices={notices}
      busy={busy}
      calm={calm}
      status={status}
      onSignIn={() => void login()}
      onSignOut={() => void logout()}
      onRefresh={() => void load()}
    />
  );
}

export default function DecksScreen() {
  return <DecksShell />;
}
