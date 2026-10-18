import { z } from "zod";
import { AppError } from "@/lib/errors";
import {
  findPlayerById,
  listWallets,
  completeOnboarding,
  reopenOnboarding,
} from "@/db/players";
import type { Player } from "@/db/schema";

export type OnboardingStep = "username" | "avatar" | "wallet" | "done";

export interface OnboardingState {
  hasUsername: boolean;
  hasAvatar: boolean;
  hasWallet: boolean;
  profileReady: boolean;
  complete: boolean;
  nextStep: OnboardingStep;
}

// Deterministic state derived only from persisted data. Full completion
// requires a verified linked wallet, which B0.5 establishes; until then a
// player with username + avatar is profile-ready but not complete.
export function getOnboardingState(
  player: Pick<Player, "usernameKey" | "avatarId" | "onboardingStatus">,
  walletCount: number
): OnboardingState {
  const hasUsername = !!player.usernameKey;
  const hasAvatar = !!player.avatarId;
  const hasWallet = walletCount > 0;
  const profileReady = hasUsername && hasAvatar;
  const complete = player.onboardingStatus === "complete" && profileReady && hasWallet;
  const nextStep: OnboardingStep = !hasUsername
    ? "username"
    : !hasAvatar
      ? "avatar"
      : !hasWallet
        ? "wallet"
        : "done";
  return { hasUsername, hasAvatar, hasWallet, profileReady, complete, nextStep };
}

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name cannot be empty")
  .max(32, "Display name must be 32 characters or fewer");

export function validateDisplayName(value: unknown): string {
  const parsed = displayNameSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid display name");
  }
  return parsed.data;
}

export const onboardBodySchema = z
  .object({
    username: z.string().optional(),
    displayName: displayNameSchema.optional(),
    avatarId: z.string().optional(),
  })
  .strict()
  .refine((b) => b.username !== undefined || b.displayName !== undefined || b.avatarId !== undefined, {
    message: "Provide at least one of username, displayName, avatarId",
  });

export type OnboardBody = z.infer<typeof onboardBodySchema>;

export function parseOnboardBody(body: unknown): OnboardBody {
  const parsed = onboardBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid onboarding request");
  }
  return parsed.data;
}

// Only these fields are ever user-editable. Unknown or privileged keys
// (id, privyDid, roles, accountStatus, wallets, ...) fail closed.
export const profilePatchSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    avatarId: z.string().optional(),
  })
  .strict()
  .refine((b) => b.displayName !== undefined || b.avatarId !== undefined, {
    message: "Provide displayName and/or avatarId",
  });

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export function parseProfilePatch(body: unknown): ProfilePatch {  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = issue?.path?.join(".");
    if (issue?.code === "unrecognized_keys") {
      throw new AppError("FORBIDDEN", `Field cannot be edited${key ? `: ${key}` : ""}`);
    }
    throw new AppError("BAD_REQUEST", issue?.message ?? "Invalid profile update");
  }
  return parsed.data;
}

// Convergent reconciliation between the stored onboardingStatus flag and the
// derived completion state. Moves pending -> complete when username, avatar
// and at least one currently-verified wallet are all present, and moves
// complete -> pending when any requirement is lost (e.g. wallet revocation).
// Idempotent: repeated calls with unchanged data rewrite nothing. Each flip
// is a single UPDATE; concurrent reconcilers converge on the same value.
export async function reconcileOnboarding(playerId: string): Promise<{
  player: Player;
  state: OnboardingState;
}> {
  const player = await findPlayerById(playerId);
  if (!player) throw new AppError("NOT_FOUND", "Player not found");
  const wallets = await listWallets(playerId);
  const verifiedCount = wallets.filter((w) => w.verifiedAt !== null).length;
  const ready = !!player.usernameKey && !!player.avatarId;
  let current = player;
  if (ready && verifiedCount > 0 && player.onboardingStatus !== "complete") {
    current = await completeOnboarding(playerId);
  } else if ((!ready || verifiedCount === 0) && player.onboardingStatus === "complete") {
    current = await reopenOnboarding(playerId);
  }
  return { player: current, state: getOnboardingState(current, verifiedCount) };
}
