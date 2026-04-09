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

/** Streamer dashboard + personal TikFinity hook require an entitled subscription (or staff / env bypass). */
export function canUseStreamerNetwork(opts: {
  role: UserRole;
  subscriptionStatus: string | null | undefined;
}): boolean {
  if (billingSkippedInEnv()) return true;
  if (hasRoleAtLeast(opts.role, "moderator")) return true;
  const s = (opts.subscriptionStatus ?? "inactive").toLowerCase();
  if (s === "active" || s === "trialing") return true;
  return false;
}
