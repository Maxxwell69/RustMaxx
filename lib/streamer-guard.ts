import type { UserRow } from "./users";
import {
  billingSkippedInEnv,
  canUseStreamerNetwork,
} from "./streamer-entitlement";
import { hasRoleAtLeast } from "./permissions";

/** Personal TikFinity hook + rules (streamer tier or higher privilege). */
export function canAccessStreamerDashboard(user: UserRow): boolean {
  if (
    !canUseStreamerNetwork({
      role: user.role,
      subscriptionStatus: user.subscription_status,
    })
  ) {
    return false;
  }
  if (billingSkippedInEnv()) {
    return hasRoleAtLeast(user.role, "player");
  }
  return hasRoleAtLeast(user.role, "streamer");
}
