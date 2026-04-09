import type { UserRow } from "./users";
import { hasRoleAtLeast } from "./permissions";

/**
 * Who can use streamer dashboard APIs (servers list, action options, webhook CRUD, rules, TikFinity hook).
 * Any logged-in app user (guest+) may configure; subscription is optional — see `billingOk` in GET /api/streamer/state.
 */
export function canAccessStreamerDashboard(user: UserRow): boolean {
  return hasRoleAtLeast(user.role, "guest");
}
