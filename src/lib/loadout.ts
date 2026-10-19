// Client-safe helpers for the B3.2d account-saved loadout. No DB, viem or
// combat-engine imports live here: the full deck check runs server-side in
// src/server/loadout.ts against the authoritative card tables.

import { z } from "zod";
import { commanderChoiceSchema, readySchema, COMMANDER_CLASS_CHOICES, type CommanderChoice } from "@/lib/battle-protocol";

export const LOADOUT_SCHEMA_VERSION = 1;

/** PUT /api/players/me/loadout body. expectedRevision is the client's last
 * seen server revision (null for a first save); it is optimistic concurrency,
 * never ownership or entitlement data. */
export const loadoutPutSchema = z
  .object({
    schemaVersion: z.literal(LOADOUT_SCHEMA_VERSION),
    cards: readySchema.shape.cards,
    commander: commanderChoiceSchema,
    expectedRevision: z.number().int().min(1).nullable(),
  })
  .strict();
export type LoadoutPut = z.infer<typeof loadoutPutSchema>;

/** The server-side row as returned by the API. */
export interface SavedLoadout {
  schemaVersion: number;
  cards: string[];
  commander: CommanderChoice;
  revision: number;
  updatedAt: string;
}

export type LoadoutSource = "server" | "local-draft" | "default";

/**
 * Picks the initial picker selection. A saved server copy always wins. The
 * remembered local draft (localStorage, unsaved) is used only when the server
 * has nothing. Otherwise the first preset with its free commander class.
 */
export function chooseInitialLoadout(opts: {
  server: SavedLoadout | null | undefined;
  serverInvalid?: boolean;
  localDraft: { cards: string[]; commander: CommanderChoice } | null;
  presets: Record<string, { cards: string[]; commanderClass: string }>;
}): { source: LoadoutSource; cards: string[]; commander: CommanderChoice } {
  if (opts.server && !opts.serverInvalid) {
    return { source: "server", cards: [...opts.server.cards], commander: opts.server.commander };
  }
  if (opts.localDraft) {
    return { source: "local-draft", cards: [...opts.localDraft.cards], commander: opts.localDraft.commander };
  }
  const first = Object.values(opts.presets)[0];
  return {
    source: "default",
    cards: first ? [...first.cards] : [],
    commander: { kind: "free", class: (first?.commanderClass ?? "scout") as (typeof COMMANDER_CLASS_CHOICES)[number] },
  };
}
