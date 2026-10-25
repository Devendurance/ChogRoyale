"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHOG_GENESIS_CHAIN_ID, CHOG_GENESIS_CONTRACT, COMMANDER_CLASS_CHOICES,
  commanderChoiceSchema, type CommanderChoice, type LobbyMessage,
} from "@/lib/battle-protocol";
import { chooseInitialLoadout, LOADOUT_SCHEMA_VERSION, type SavedLoadout } from "@/lib/loadout";
import { GameIcon } from "@/components/game/GameIcon";
import { Portrait } from "./portrait";
import { useSpriteManifest } from "./use-sprite-manifest";
import { portraitForCard, portraitForCommanderClass } from "./sprite-registry";
import { candidateLabel, usableCandidate, type CommanderCandidate } from "./commander-candidate";
import "./loadout-picker.css";

type NftCandidate = CommanderCandidate;
interface CommandersResponse { nftCommanders: NftCandidate[]; freshness: "live" | "cached" }
interface LoadoutGetResponse { loadout: SavedLoadout | null; invalidSaved?: { revision: number; reason: string } }
interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message: string; details?: LoadoutGetResponse };
}
const STORAGE_KEY = "b3.loadout";
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function loadSaved(): { cards: string[]; commander: CommanderChoice } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { cards?: unknown; commander?: unknown };
    const parsed = commanderChoiceSchema.safeParse(value.commander);
    if (!Array.isArray(value.cards) || !parsed.success) return null;
    return { cards: value.cards.filter((c): c is string => typeof c === "string").slice(0, 7), commander: parsed.data };
  } catch { return null; }
}

const usableNft = (candidate: NftCandidate) => usableCandidate(candidate);

export interface LoadoutPickerProps {
  lobby: LobbyMessage;
  mine: LobbyMessage["mine"];
  getAccessToken: () => Promise<string | null>;
  onConfirm: (cards: string[], commander: CommanderChoice) => void;
  onEdit: () => void;
}

export default function LoadoutPicker({ lobby, mine, getAccessToken, onConfirm, onEdit }: LoadoutPickerProps) {
  const ordinary = lobby.catalog;
  const kit = useSpriteManifest();
  const [saved] = useState(() => typeof window === "undefined" ? null : loadSaved());
  const [initial] = useState(() => chooseInitialLoadout({ server: null, localDraft: saved, presets: lobby.presets }));
  const [cards, setCards] = useState<string[]>(() => initial.cards.filter((c) => ordinary.some((o) => o.id === c)));
  const [commander, setCommander] = useState<CommanderChoice>(initial.commander);
  const [manualToken, setManualToken] = useState("");
  const [nfts, setNfts] = useState<NftCandidate[]>([]);
  const [nftStatus, setNftStatus] = useState<string | null>("Loading commanders");
  const [nftFreshness, setNftFreshness] = useState("cached");
  const [serverDeck, setServerDeck] = useState<LoadoutGetResponse | null>(null);
  const [readStatus, setReadStatus] = useState<"loading" | "loaded" | "session" | "unavailable">("loading");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [edited, setEdited] = useState(false);
  const [conflict, setConflict] = useState<LoadoutGetResponse | null>(null);
  const dirty = useRef(false);
  // The catalog and presets belong to this mounted lobby. Parent countdown
  // renders and ready-flag snapshots must never refetch the account draft.
  const initialInputs = useRef({ ordinary, presets: lobby.presets, saved });

  const fetchLoadout = useCallback(async () => {
    setReadStatus("loading");
    try {
      const token = await getAccessToken();
      if (!token) { setReadStatus("session"); return; }
      const response = await fetch("/api/players/me/loadout", { headers: { authorization: `Bearer ${token}` } });
      const body = await response.json() as Envelope<LoadoutGetResponse>;
      if (response.status === 401 || response.status === 403) { setReadStatus("session"); return; }
      if (!response.ok || !body.success || !body.data || !("loadout" in body.data)) {
        setReadStatus("unavailable"); return;
      }
      setServerDeck(body.data);
      setReadStatus("loaded");
      setConflict(null);
      if (!dirty.current) {
        const inputs = initialInputs.current;
        const pick = chooseInitialLoadout({ server: body.data.loadout, serverInvalid: !!body.data.invalidSaved, localDraft: inputs.saved, presets: inputs.presets });
        setCards(pick.cards.filter((c) => inputs.ordinary.some((o) => o.id === c)));
        setCommander(pick.commander);
      }
    } catch { setReadStatus("unavailable"); }
  }, [getAccessToken]);

  const fetchNfts = useCallback(async (fresh: boolean) => {
    setNftStatus("Loading commanders");
    try {
      const token = await getAccessToken();
      if (!token) { setNftStatus("Session unavailable. Sign in again to check your commanders."); return; }
      const response = await fetch(`/api/players/me/commanders${fresh ? "?fresh=1" : ""}`, { headers: { authorization: `Bearer ${token}` } });
      const body = await response.json() as Envelope<CommandersResponse>;
      if (!response.ok || !body.success || !Array.isArray(body.data?.nftCommanders)) {
        setNftStatus("Commander service unavailable. Refresh to try again."); return;
      }
      setNfts(body.data.nftCommanders);
      setNftFreshness(body.data.freshness);
      setNftStatus(null);
    } catch { setNftStatus("Commander service unavailable. Refresh to try again."); }
  }, [getAccessToken]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchLoadout(); void fetchNfts(false); }, 0);
    return () => clearTimeout(timer);
  }, [fetchLoadout, fetchNfts]);

  useEffect(() => {
    if (!dirty.current) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards, commander })); } catch { /* Account save and readiness work without local storage. */ }
  }, [cards, commander]);

  const markDirty = () => { dirty.current = true; setEdited(true); setSaveMsg(null); };
  const toggle = (id: string) => {
    markDirty();
    setCards((current) => current.includes(id) ? current.filter((c) => c !== id) : current.length < 7 ? [...current, id] : current);
  };
  const selectNft = (tokenId: string) => {
    markDirty();
    setCommander({ kind: "nft", chainId: CHOG_GENESIS_CHAIN_ID, contract: CHOG_GENESIS_CONTRACT, tokenId });
  };

  const saveDeck = async (expectedRevision: number | null) => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const token = await getAccessToken();
      if (!token) { setSaveMsg("Session unavailable. Your draft is still here."); return; }
      const response = await fetch("/api/players/me/loadout", {
        method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: LOADOUT_SCHEMA_VERSION, cards, commander, expectedRevision }),
      });
      const body = await response.json() as Envelope<{ loadout: SavedLoadout }>;
      if (response.status === 409) {
        setConflict(body.error?.details ?? { loadout: null });
        setSaveMsg("A newer deck was saved elsewhere. Your draft is still here.");
        return;
      }
      if (!response.ok || !body.success || !body.data?.loadout) { setSaveMsg("Save failed. Your draft is still here. Try again."); return; }
      setConflict(null);
      setServerDeck({ loadout: body.data.loadout });
      setReadStatus("loaded");
      setSaveMsg("Saved to your account.");
    } catch { setSaveMsg("Save failed. Your draft is still here. Try again."); }
    finally { setSaving(false); }
  };

  const selectedNft = commander.kind === "nft" ? nfts.find((n) => n.tokenId === commander.tokenId) : undefined;
  const advisory = useMemo(() => {
    if (new Set(cards).size !== cards.length) return "Choose seven different cards.";
    if (cards.length !== 7) return `Choose ${7 - cards.length} more ${cards.length === 6 ? "card" : "cards"} to complete your deck.`;
    if (commander.kind === "nft" && !/^\d{1,78}$/.test(commander.tokenId)) return "Enter a valid NFT token ID.";
    if (selectedNft && !usableNft(selectedNft)) return "This commander is unavailable. Choose another or refresh your commanders.";
    return null;
  }, [cards, commander, selectedNft]);
  const catalog = useMemo(() => new Map(ordinary.map((c) => [c.id, c])), [ordinary]);
  const displayedCards = mine?.cards ?? cards;
  const average = displayedCards.length ? (displayedCards.reduce((sum, id) => sum + (catalog.get(id)?.cost ?? 0), 0) / displayedCards.length).toFixed(1) : "0";
  const commanderClass = mine?.commander.class ?? (commander.kind === "free" ? commander.class : selectedNft?.commander?.class);
  const commanderName = mine?.commander.name ?? (commander.kind === "free" ? titleCase(commander.class) : selectedNft?.name ?? "NFT commander");
  const commanderKind = mine?.commander.kind ?? commander.kind;
  // Token art only from the authenticated commander read, never from a typed claim.
  const tokenArt = commanderKind === "nft" && selectedNft?.imageUrl && (!mine || (mine.commander.kind === "nft" && mine.commander.tokenId === selectedNft.tokenId)) ? selectedNft.imageUrl : null;
  const sameAsAccount = !!serverDeck?.loadout && JSON.stringify(serverDeck.loadout.cards) === JSON.stringify(cards) && JSON.stringify(serverDeck.loadout.commander) === JSON.stringify(commander);
  const deckStatus = readStatus === "loading" ? "Loading account deck"
    : readStatus === "session" ? "Session unavailable. Your draft is still here."
    : readStatus === "unavailable" ? "Account deck unavailable. Your draft is still here."
    : conflict ? "Save conflict. Choose which deck to keep."
    : serverDeck?.invalidSaved ? "Your saved deck needs review. Choose a valid deck and save again."
    : sameAsAccount ? "Saved to your account"
    : serverDeck?.loadout ? "Unsaved changes"
    : edited || saved ? "Local draft. Not saved to your account." : "No account deck saved yet";
  const frozen = lobby.locked || saving;
  const conflictRevision = conflict?.loadout?.revision ?? conflict?.invalidSaved?.revision;
  const bothPlayersReady = lobby.players.length === 2 && lobby.players.every((player) => !!player.username && player.ready);

  return (
    <section className="loadout-picker" aria-label="Your battle loadout">
      <div className="lp-squad">
        <div className="lp-commander">
          <div className="lp-commander-heading"><GameIcon kind="crown" size={22} /><span>Commander</span></div>
          {tokenArt
            ? <Portrait key={tokenArt} src={tokenArt} name={commanderName} className="lp-commander-art lp-commander-art--token" />
            : <Portrait key={commanderClass ?? "unresolved"} src={kit && commanderClass ? portraitForCommanderClass(kit, commanderClass) : null} name={commanderClass ? titleCase(commanderClass) : "Awaiting verification"} className="lp-commander-art" style={{ objectFit: "contain" }} />}
          <div className="lp-commander-copy"><h3>{commanderName}</h3><span>{commanderKind === "free" ? "Free commander" : mine ? (mine.commander.basis === "borrowed" ? "Borrowed commander" : "Verified commander") : selectedNft?.basis === "borrowed" || selectedNft?.ownership === "borrowed" ? "Borrowed. Checked when you ready up" : "Checked when you ready up"}</span><small>{tokenArt ? `Genesis token art${commanderClass ? ` · ${titleCase(commanderClass)} class` : ""}` : commanderClass ? `${titleCase(commanderClass)} class art` : "Class resolves after verification"}</small></div>
        </div>
        <div className="lp-deck">
          <div className="lp-deck-heading"><h3><GameIcon kind="deck" size={22} />Your Battle Deck</h3><span>{displayedCards.length}/7 cards <i />{average} avg. energy</span></div>
          <div className="lp-selected" aria-label="Seven ordinary card slots">
            {Array.from({ length: 7 }, (_, index) => {
              const card = catalog.get(displayedCards[index]);
              return <div className={`lp-card${card ? "" : " lp-card--empty"}`} key={index}>
                {card ? <><span className="lp-cost" aria-label={`${card.cost} energy`}>{card.cost}</span><Portrait key={card.id} src={kit ? portraitForCard(kit, card.id) : null} name={card.name} className="lp-card-art" style={{ objectFit: "contain" }} /><span className="lp-card-name">{card.name}</span></> : <><span className="lp-empty-mark" aria-hidden="true">+</span><span className="lp-card-name">Choose a card</span></>}
              </div>;
            })}
          </div>
          <p className="lp-deck-note">Seven cards. One commander. Your next battle starts here.</p>
        </div>
      </div>

      {mine ? <div className="lp-confirmed" role="status"><GameIcon kind="ready" size={28} /><div><h3>{lobby.locked ? "Preparing your battle" : "You're Ready"}</h3><p>{lobby.locked ? "Both players are ready. The server is checking the final loadouts." : bothPlayersReady ? "Both players are ready. Waiting for the server to start the battle." : "Your loadout is confirmed. Waiting for the other player to ready up."}</p></div>{!lobby.locked && <button type="button" className="lp-button" onClick={onEdit}>Edit Loadout</button>}</div> : <>
        <div className="lp-ready-bar">
          <div><span className="lp-eyebrow">{advisory ? "Complete your squad" : "Squad selected"}</span><p role="status">{advisory ?? "Ready up to confirm this loadout for the match."}</p></div>
          <button type="button" className="lp-button lp-button--ready" disabled={!!advisory || frozen} onClick={() => {
            dirty.current = true;
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards, commander })); } catch { /* Storage never blocks server confirmation. */ }
            onConfirm(cards, commander);
          }}><GameIcon kind="ready" size={26} />{lobby.locked ? "Checking Loadouts" : "Ready for Battle"}</button>
        </div>
        <div className="lp-account"><span role="status">{deckStatus}</span><button type="button" className="lp-button lp-button--small" disabled={!!advisory || frozen || readStatus !== "loaded" || !!conflict || sameAsAccount} onClick={() => void saveDeck(serverDeck?.loadout?.revision ?? serverDeck?.invalidSaved?.revision ?? null)}>{saving ? "Saving" : "Save Deck"}</button>{(readStatus === "session" || readStatus === "unavailable") && <button type="button" className="lp-button lp-button--small" onClick={() => void fetchLoadout()}>Retry Account</button>}</div>
        {saveMsg && <p className={`lp-message${sameAsAccount && !conflict ? " lp-message--success" : ""}`} role="status">{saveMsg}</p>}
        {conflict && <div className="lp-conflict" role="alert"><p>Your account deck changed on another device. Load it here, or replace it with this draft.</p><div>{conflict.loadout && <button type="button" className="lp-button" disabled={frozen} onClick={() => {
          setCards(conflict.loadout!.cards.filter((c) => ordinary.some((o) => o.id === c)));
          setCommander(conflict.loadout!.commander); setServerDeck(conflict); setConflict(null); setSaveMsg(null);
        }}>Load Account Deck</button>}{conflictRevision !== undefined ? <button type="button" className="lp-button" disabled={frozen} onClick={() => void saveDeck(conflictRevision)}>Replace with My Draft</button> : <button type="button" className="lp-button" onClick={() => void fetchLoadout()}>Reload Account Status</button>}</div></div>}

        <details className="lp-editor">
          <summary><GameIcon kind="deck" size={20} />Edit Deck &amp; Presets<span>Choose your seven</span></summary>
          <div className="lp-editor-content">
            <div className="lp-presets">{Object.entries(lobby.presets).map(([name, preset]) => <button type="button" className="lp-button lp-button--small" key={name} disabled={frozen} onClick={() => {
              markDirty(); setCards([...preset.cards]);
              if (COMMANDER_CLASS_CHOICES.includes(preset.commanderClass as typeof COMMANDER_CLASS_CHOICES[number])) setCommander({ kind: "free", class: preset.commanderClass as typeof COMMANDER_CLASS_CHOICES[number] });
            }}>{titleCase(name)}</button>)}</div>
            <p className="lp-help">Select seven different cards. Remove a selected card before adding a replacement.</p>
            <div className="lp-collection">{ordinary.map((card) => {
              const selected = cards.includes(card.id);
              return <button type="button" className={`lp-choice${selected ? " lp-choice--selected" : ""}`} key={card.id} aria-pressed={selected} aria-label={`${selected ? "Remove" : "Add"} ${card.name}, ${card.cost} energy`} title={card.description} disabled={frozen || (!selected && cards.length >= 7)} onClick={() => toggle(card.id)}><span className="lp-cost">{card.cost}</span><Portrait src={kit ? portraitForCard(kit, card.id) : null} name={card.name} style={{ objectFit: "contain" }} /><span>{card.name}</span>{selected && <GameIcon kind="ready" size={18} className="lp-choice-check" />}</button>;
            })}</div>
            <details className="lp-subdetails"><summary>Card details</summary>{ordinary.filter((card) => cards.includes(card.id)).map((card) => <p key={card.id}><strong>{card.name}</strong> · {card.cost} energy · {card.kind}{card.air ? " · Air" : ""}<br />{card.description}</p>)}</details>
          </div>
        </details>
        <details className="lp-editor"><summary><GameIcon kind="crown" size={20} />Change Commander<span>Free or Genesis</span></summary><div className="lp-editor-content">
          <div className="lp-free-commanders">{COMMANDER_CLASS_CHOICES.map((cls) => <button type="button" key={cls} disabled={frozen} aria-pressed={commander.kind === "free" && commander.class === cls} className={`lp-choice${commander.kind === "free" && commander.class === cls ? " lp-choice--selected" : ""}`} onClick={() => { markDirty(); setCommander({ kind: "free", class: cls }); }}><Portrait src={kit ? portraitForCommanderClass(kit, cls) : null} name={titleCase(cls)} style={{ objectFit: "contain" }} /><span>{titleCase(cls)}</span><small>Free · Class art</small></button>)}</div>
          <div className="lp-nft-heading"><h4>Your Genesis Commanders</h4><button type="button" className="lp-button lp-button--small" disabled={frozen || nftStatus === "Loading commanders"} onClick={() => void fetchNfts(true)}>Refresh Commanders</button></div>
          {nftStatus && <p className="lp-help" role="status">{nftStatus}</p>}
          {!nfts.length && !nftStatus && <p className="lp-help">No Genesis commander candidates returned for this account.</p>}
          <div className="lp-nfts">{nfts.map((candidate) => <button type="button" key={candidate.tokenId} className={`lp-nft${commander.kind === "nft" && commander.tokenId === candidate.tokenId ? " lp-nft--selected" : ""}`} disabled={frozen || !usableNft(candidate)} onClick={() => selectNft(candidate.tokenId)}>
            {candidate.imageUrl && <Portrait src={candidate.imageUrl} name={candidate.name ?? "Genesis commander"} className="lp-nft-art" />}
            {(() => { const label = candidateLabel(candidate); return <span><strong>{candidate.name ?? "Genesis commander"}</strong><small><b className="lp-badge" data-badge={label.badge}>{label.badge}</b>{candidate.commander ? titleCase(candidate.commander.class) : "Class pending"}</small><small>{label.detail}</small></span>; })()}
          </button>)}</div>
          <details className="lp-subdetails"><summary>Ownership checks &amp; token ID</summary><p>Genesis ownership or borrowed access is checked by the server when you ready up and again at match start. {nftFreshness === "live" ? "This list was just checked onchain." : "This list comes from your last ownership check. Refresh to check again."} Saving a deck does not verify access.</p><label htmlFor="lp-token-id">Use a Genesis token ID</label><div className="lp-manual"><input id="lp-token-id" inputMode="numeric" placeholder="Genesis token ID" value={manualToken} disabled={frozen} onChange={(event) => setManualToken(event.target.value.replace(/\D/g, ""))} /><button type="button" className="lp-button lp-button--small" disabled={!/^\d{1,78}$/.test(manualToken) || frozen} onClick={() => selectNft(manualToken)}>Use Token</button></div>{commander.kind === "nft" && <p>Selected token claim: {commander.tokenId}. The server confirms access.</p>}</details>
        </div></details>
      </>}
    </section>
  );
}
