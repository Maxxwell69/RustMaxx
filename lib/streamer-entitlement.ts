import type { UserRole } from "./permissions";
import { hasRoleAtLeast } from "./permissions";

export type SubscriptionStatus =
  | "inactive"
  | "trialing"
  | "active"
  | "canceled"
  | "past_due";

export function billingSkippedInEnv(): boolean {
  const v = process.env.SKIP_BILLING?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Streamer TikFinity / webhook features: available to logged-in users (guest+).
 * Paid tiers raise webhook limits; subscription active also counts as entitled for legacy accounts.
 */
export function canUseStreamerNetwork(opts: {
  role: UserRole;
  subscriptionStatus: string | null | undefined;
}): boolean {
  if (billingSkippedInEnv()) return true;
  if (hasRoleAtLeast(opts.role, "moderator")) return true;
  const s = (opts.subscriptionStatus ?? "inactive").toLowerCase();
  if (s === "active" || s === "trialing") return true;
  if (hasRoleAtLeast(opts.role, "guest")) return true;
  return false;
}
