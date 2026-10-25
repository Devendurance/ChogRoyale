// Ready-room labels for Genesis commander candidates. Labels come only from
// server-returned ownership and loan data. Client time is a presentation
// guard, and the battle server re-checks access at ready and at match start.

export interface CommanderCandidate {
  tokenId: string;
  name: string | null;
  imageUrl: string | null;
  status: "derived" | "pending";
  eligible: boolean;
  basis?: "owned" | "borrowed";
  ownership?: "owned" | "borrowed" | "lent";
  loan?: { endsAt: string } | null;
  eligibilityFreshness?: "live" | "cached";
  commander?: { class: string; variant: string; prestige: string | null; powerScore: number | null };
  provenance?: { rulesetVersion: string; contentHash: string };
  reason?: string;
}

export type CandidateBadge = "OWNED" | "BORROWED" | "LENT" | "PENDING" | "UNVERIFIED";

const isBorrowed = (candidate: CommanderCandidate) => candidate.basis === "borrowed" || candidate.ownership === "borrowed";
const loanLive = (candidate: CommanderCandidate, now: number) => !!candidate.loan && Number.isFinite(Date.parse(candidate.loan.endsAt)) && Date.parse(candidate.loan.endsAt) > now;

export function usableCandidate(candidate: CommanderCandidate, now: number = Date.now()): boolean {
  if (candidate.status !== "derived" || !candidate.eligible || candidate.ownership === "lent") return false;
  return isBorrowed(candidate) ? loanLive(candidate, now) : true;
}

const shortDate = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Badge plus one line of plain detail. Never includes loan or party ids. */
export function candidateLabel(candidate: CommanderCandidate, now: number = Date.now()): { badge: CandidateBadge; detail: string } {
  if (candidate.ownership === "lent") {
    return { badge: "LENT", detail: candidate.loan && loanLive(candidate, now) ? `Lent until ${shortDate(candidate.loan.endsAt)}. Unavailable while lent.` : "Lent. Unavailable while lent." };
  }
  if (isBorrowed(candidate)) {
    if (!loanLive(candidate, now)) return { badge: "BORROWED", detail: "Loan ended. Ask the owner for a new loan." };
    return { badge: "BORROWED", detail: `Borrowed until ${shortDate(candidate.loan!.endsAt)}` };
  }
  if (candidate.status !== "derived") return { badge: "PENDING", detail: candidate.reason ?? "Commander stats are still being prepared." };
  if (!candidate.eligible) return { badge: "UNVERIFIED", detail: candidate.reason ?? "Ownership could not be confirmed yet." };
  return { badge: "OWNED", detail: "In a verified wallet" };
}
