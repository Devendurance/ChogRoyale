import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { LOADOUT_SCHEMA_VERSION, loadoutPutSchema, type SavedLoadout } from "@/lib/loadout";
import { validateSavedLoadout } from "@/server/loadout";
import { commanderFromRow, getLoadout, saveLoadout } from "@/db/loadouts";
import type { PlayerLoadout } from "@/db/schema";
import { logger } from "@/lib/logger";

const MAX_BODY = 4096;

function loadoutView(row: PlayerLoadout): SavedLoadout {
  return {
    schemaVersion: row.schemaVersion,
    cards: row.cards,
    commander: commanderFromRow(row),
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A stored row that fails today's validation (unsupported schema version or
 * cards the ruleset no longer accepts) is reported as invalidSaved so the
 * client falls back to a draft/default but can still overwrite it by sending
 * the known revision.
 */
function viewFor(row: PlayerLoadout): { loadout: SavedLoadout | null; invalidSaved?: { revision: number; reason: string } } {
  if (row.schemaVersion !== LOADOUT_SCHEMA_VERSION) {
    return { loadout: null, invalidSaved: { revision: row.revision, reason: `unsupported schema version ${row.schemaVersion}` } };
  }
  const commander = commanderFromRow(row);
  try {
    validateSavedLoadout(row.cards, commander);
  } catch (err) {
    return { loadout: null, invalidSaved: { revision: row.revision, reason: err instanceof Error ? err.message : "saved deck no longer valid" } };
  }
  return { loadout: loadoutView(row) };
}

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const row = await getLoadout(player.id);
    return success(row ? viewFor(row) : { loadout: null }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("loadout read failure", { requestId });
    }
    return failure(err, requestId);
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const len = Number(request.headers.get("content-length") ?? "0");
    if (len > MAX_BODY) throw new AppError("BAD_REQUEST", "Loadout body too large");
    const text = await request.text();
    if (text.length > MAX_BODY) throw new AppError("BAD_REQUEST", "Loadout body too large");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AppError("BAD_REQUEST", "Body must be JSON");
    }
    const parsed = loadoutPutSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid loadout body");
    }
    const input = parsed.data;
    validateSavedLoadout(input.cards, input.commander);
    const row = await saveLoadout(player.id, { cards: input.cards, commander: input.commander }, input.expectedRevision);
    return success({ loadout: loadoutView(row) }, { requestId });
  } catch (err) {
    if (err instanceof AppError && err.code === "CONFLICT") {
      const current = (err.details as { current?: PlayerLoadout } | undefined)?.current;
      return failure(
        new AppError("CONFLICT", err.message, {
          retryable: err.retryable,
          details: { loadout: current ? viewFor(current).loadout : null, invalidSaved: current ? viewFor(current).invalidSaved : undefined },
        }),
        requestId
      );
    }
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("loadout save failure", { requestId });
    }
    return failure(err, requestId);
  }
}
