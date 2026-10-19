"use client";

// B3.2a loadout picker for the dev battle lobby. The player picks 7 distinct
// ordinary cards plus one commander (a free class, or a Chog Genesis NFT they
// claim to own). Everything here is advisory: the server re-validates the
// deck, and NFT ownership is proven onchain when confirming and again at
// match start. Client-side checks only catch obvious mistakes early.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CHOG_GENESIS_CHAIN_ID,
  CHOG_GENESIS_CONTRACT,
  COMMANDER_CLASS_CHOICES,
  type CommanderChoice,
  type LobbyMessage,
} from "@/lib/battle-protocol";

interface NftCandidate {
  tokenId: string;
  name: string | null;
  imageOriginal: string | null;
  imageUrl: string | null;
  status: "derived" | "pending";
  eligible: boolean;
  eligibilityFreshness?: "live" | "cached";
  commander?: { class: string; variant: string; prestige: string | null; powerScore: number | null };
  provenance?: { rulesetVersion: string; contentHash: string; derivationCount?: number; derivedAt?: string };
  reason?: string;
}

interface CommandersResponse {
  nftCommanders: NftCandidate[];
  rulesetVersion: string;
  freshness: "live" | "cached";
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

const STORAGE_KEY = "b3.loadout";

function loadSaved(): { cards: string[]; commander: CommanderChoice } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { cards?: unknown; commander?: unknown };
    if (!Array.isArray(j.cards) || typeof j.commander !== "object" || j.commander === null) return null;
    return { cards: j.cards.filter((c): c is string => typeof c === "string"), commander: j.commander as CommanderChoice };
  } catch {
    return null;
  }
}

export default function LoadoutPicker(props: {
  lobby: LobbyMessage;
  mine: LobbyMessage["mine"];
  getAccessToken: () => Promise<string | null>;
  onConfirm: (cards: string[], commander: CommanderChoice) => void;
  onEdit: () => void;
}) {
  const { lobby, mine } = props;
  const ordinary = lobby.catalog;
  // Convenience only: the last confirmed loadout is remembered locally.
  // The server re-validates everything; durable deck saving is a later slice.
  const [saved] = useState(() => (typeof window === "undefined" ? null : loadSaved()));
  const [cards, setCards] = useState<string[]>(() => saved?.cards.filter((c) => ordinary.some((o) => o.id === c)) ?? []);
  const [commander, setCommander] = useState<CommanderChoice>(saved?.commander ?? { kind: "free", class: "scout" });
  const [manualToken, setManualToken] = useState("");
  const [nfts, setNfts] = useState<NftCandidate[]>([]);
  const [nftStatus, setNftStatus] = useState<string | null>(null);
  const [nftFreshness, setNftFreshness] = useState<string>("cached");

  const fetchNfts = useCallback(
    async (fresh: boolean) => {
      try {
        const token = await props.getAccessToken();
        if (!token) {
          setNftStatus("no session");
          return;
        }
        setNftStatus("loading");
        const res = await fetch(`/api/players/me/commanders${fresh ? "?fresh=1" : ""}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const j = (await res.json()) as Envelope<CommandersResponse>;
        if (!j.success || !j.data) {
          setNftStatus(j.error?.message ?? "unavailable");
          return;
        }
        setNfts(j.data.nftCommanders);
        setNftFreshness(j.data.freshness);
        setNftStatus(null);
      } catch {
        setNftStatus("unavailable");
      }
    },
    [props]
  );
  useEffect(() => {
    const t = setTimeout(() => void fetchNfts(false), 0);
    return () => clearTimeout(t);
  }, [fetchNfts]);

  const toggle = (id: string) => setCards((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : cs.length < 7 ? [...cs, id] : cs));
  const catalog = useMemo(() => new Map(ordinary.map((c) => [c.id, c])), [ordinary]);
  const avg = cards.length ? (cards.reduce((s, c) => s + (catalog.get(c)?.cost ?? 0), 0) / cards.length).toFixed(1) : "0";

  const advisory = useMemo(() => {
    if (new Set(cards).size !== cards.length) return "Cards must be distinct";
    if (cards.length !== 7) return `Pick exactly 7 ordinary cards (${cards.length}/7)`;
    if (commander.kind === "nft" && !/^\d{1,78}$/.test(commander.tokenId)) return "NFT token id must be an integer";
    return null;
  }, [cards, commander]);

  const selectNft = (tokenId: string) => setCommander({ kind: "nft", chainId: CHOG_GENESIS_CHAIN_ID, contract: CHOG_GENESIS_CONTRACT, tokenId });
  const nftSelected = commander.kind === "nft" ? commander.tokenId : null;

  if (mine) {
    const c = mine.commander;
    return (
      <section style={{ display: "grid", gap: 6 }}>
        <div>Your confirmed loadout {lobby.locked ? "(locked, match starting)" : ""}:</div>
        <div style={{ fontSize: 12 }}>{mine.cards.map((id) => catalog.get(id)?.name ?? id).join(", ")}</div>
        <div style={{ fontSize: 12 }}>
          commander: {c.name} ({c.class}, {c.variant}, {c.prestige})
          {c.kind === "nft" ? ` · token ${c.tokenId} · verified ${c.basis}` : " · free"}
        </div>
        {!lobby.locked && <button onClick={props.onEdit}>Edit loadout</button>}
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 8 }}>
      <div>Pick 7 ordinary cards and 1 commander. The server validates the loadout; ownership of NFT commanders is proven onchain at confirm and again at match start.</div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {Object.entries(lobby.presets).map(([name, p]) => (
          <button key={name} style={{ fontSize: 11 }} onClick={() => (setCards([...p.cards]), setCommander({ kind: "free", class: p.commanderClass as (typeof COMMANDER_CLASS_CHOICES)[number] }))}>
            preset: {name}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
        {ordinary.map((c) => {
          const on = cards.includes(c.id);
          return (
            <button key={c.id} onClick={() => toggle(c.id)} title={c.description} style={{ padding: 4, fontSize: 11, textAlign: "left", border: on ? "2px solid #fbbf24" : "1px solid #4b5563" }}>
              <div>
                {c.name} · {c.cost}e {c.kind}
                {c.air ? " (air)" : ""}
              </div>
              <div style={{ fontSize: 10, color: "#9ca3af" }}>{c.description}</div>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12 }}>
        selected {cards.length}/7 · avg {avg}e{cards.length === 7 ? ` · ${cards.map((id) => catalog.get(id)?.name ?? id).join(", ")}` : ""}
      </div>

      <div style={{ fontSize: 13 }}>Commander</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {COMMANDER_CLASS_CHOICES.map((cls) => (
          <button key={cls} onClick={() => setCommander({ kind: "free", class: cls })} style={{ fontSize: 11, border: commander.kind === "free" && commander.class === cls ? "2px solid #fbbf24" : "1px solid #4b5563" }}>
            Free {cls}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 13 }}>
        Chog Genesis NFT commanders <span style={{ fontSize: 11, color: "#9ca3af" }}>(candidate {nftFreshness}; final ownership proof happens on the server)</span>
        <button style={{ marginLeft: 8, fontSize: 11 }} onClick={() => void fetchNfts(true)}>
          Re-check onchain
        </button>
      </div>
      {nftStatus && <div style={{ fontSize: 11 }}>NFT list: {nftStatus}</div>}
      <div style={{ display: "grid", gap: 4 }}>
        {nfts.map((n) => {
          const sel = nftSelected === n.tokenId;
          const usable = n.status === "derived" && n.eligible;
          return (
            <button
              key={n.tokenId}
              disabled={!usable}
              onClick={() => selectNft(n.tokenId)}
              style={{ display: "flex", gap: 8, alignItems: "center", padding: 4, fontSize: 11, textAlign: "left", border: sel ? "2px solid #fbbf24" : "1px solid #4b5563", opacity: usable ? 1 : 0.5 }}>
              {n.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={n.imageUrl} alt={n.name ?? n.tokenId} width={32} height={32} />
              )}
              <span>
                <div>
                  {n.name ?? `Chog Genesis #${n.tokenId}`} · token {n.tokenId}
                  {n.commander ? ` · ${n.commander.class} · ${n.commander.variant} · ${n.commander.prestige ?? ""}` : ""}
                </div>
                <div style={{ fontSize: 10, color: "#9ca3af" }}>
                  {n.status === "derived" ? `${n.provenance?.rulesetVersion} · hash ${n.provenance?.contentHash.slice(0, 10)} · candidate (${n.eligibilityFreshness ?? nftFreshness})` : `pending: ${n.reason ?? "not derived"}`}
                </div>
              </span>
            </button>
          );
        })}
        {nfts.length === 0 && !nftStatus && <div style={{ fontSize: 11, color: "#9ca3af" }}>No eligible derived NFTs indexed for your verified wallets.</div>}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
        <input
          placeholder="NFT token ID (verified onchain at match start)"
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value.replace(/\D/g, ""))}
          style={{ color: "#000", width: 260 }}
        />
        <button disabled={!manualToken} onClick={() => selectNft(manualToken)}>
          Use token {manualToken || "…"}
        </button>
        {nftSelected && !nfts.some((n) => n.tokenId === nftSelected) && <span>manual token {nftSelected} selected, ownership will be verified onchain</span>}
      </div>

      {advisory && <div style={{ fontSize: 12, color: "#fca5a5" }}>{advisory}</div>}
      <div>
        <button disabled={!!advisory} onClick={() => (localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards, commander })), props.onConfirm(cards, commander))}>
          Confirm loadout
        </button>
      </div>
    </section>
  );
}
