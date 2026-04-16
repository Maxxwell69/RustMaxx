import type { AuthMePayload } from "@/lib/auth-me-payload";

/** Main nav entries; flags = which signup persona should see this link (union when multiple personas). */
export const SITE_NAV_LINKS = [
  { href: "/servers", label: "Dashboard", owner: true, streamer: false, fan: false },
  { href: "/", label: "Home", owner: true, streamer: true, fan: true },
  { href: "/server-list", label: "Server list", owner: true, streamer: false, fan: false },
  { href: "/streamers", label: "Streamers", owner: false, streamer: true, fan: true },
  { href: "/viewer/superfan", label: "Superfans", owner: false, streamer: false, fan: true },
  {
    href: "/streamer-interaction",
    label: "Streamer Interaction",
    owner: false,
    streamer: true,
    fan: false,
  },
  { href: "/features", label: "Features", owner: true, streamer: true, fan: true },
] as const;

export type SiteNavLink = (typeof SITE_NAV_LINKS)[number];

/** Logged-in navigation filtered by signup personas. Staff roles see everything. */
export function filterNavLinksForUser(
  me: Pick<
    AuthMePayload,
    "role" | "signup_interested_server_owner" | "signup_interested_streamer" | "signup_interested_fan"
  > | null
): readonly SiteNavLink[] {
  if (!me) return SITE_NAV_LINKS;
  if (me.role === "super_admin" || me.role === "admin") return SITE_NAV_LINKS;

  const owner = me.signup_interested_server_owner === true;
  const streamer = me.signup_interested_streamer === true;
  const fan = me.signup_interested_fan === true;
  if (!owner && !streamer && !fan) return SITE_NAV_LINKS;

  return SITE_NAV_LINKS.filter((link) => {
    if (owner && link.owner) return true;
    if (streamer && link.streamer) return true;
    if (fan && link.fan) return true;
    return false;
  });
}
