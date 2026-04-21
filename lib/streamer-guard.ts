import type { UserRow } from "./users";
import { hasRoleAtLeast } from "./permissions";
import { userIsApprovedStreamer } from "./superfan";

/**
 * Who can use streamer dashboard APIs (servers list, action options, webhook CRUD, rules, TikFinity hook).
 * Any logged-in app user (guest+) may configure; subscription is optional — see `billingOk` in GET /api/streamer/state.
 */
export function canAccessStreamerDashboard(user: UserRow): boolean {
  return hasRoleAtLeast(user.role, "guest");
}

/**
 * Per-streamer TikFinity webhook hits must belong to an account with a RustMaxx staff-approved streamer application.
 * The dashboard (`canAccessStreamerDashboard`) stays guest+ for exploring the UI; webhook execution is gated separately.
 */
export async function canUsePerStreamerTikfinityWebhook(user: UserRow): Promise<boolean> {
  if (!user) return false;
  if (hasRoleAtLeast(user.role, "super_admin")) return true;
  return userIsApprovedStreamer(user.id);
}
