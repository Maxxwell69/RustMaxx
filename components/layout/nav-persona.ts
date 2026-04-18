import type { AuthMePayload } from "@/lib/auth-me-payload";

export type PersonaKeyedLink = {
  readonly href: string;
  readonly label: string;
  readonly owner: boolean;
  readonly streamer: boolean;
  readonly fan: boolean;
};

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
] as const satisfies readonly PersonaKeyedLink[];

export type SiteNavLink = (typeof SITE_NAV_LINKS)[number];

/** Dashboard footer quick links (same persona rules as main nav). */
export const DASHBOARD_FOOTER_LINKS = [
  { href: "/servers", label: "Servers dashboard", owner: true, streamer: false, fan: false },
  { href: "/server-list", label: "Public server list", owner: true, streamer: false, fan: false },
  { href: "/streamers", label: "Public streamers", owner: false, streamer: true, fan: true },
  {
    href: "/streamer-interaction",
    label: "Streamer interaction",
    owner: false,
    streamer: true,
    fan: false,
  },
  { href: "/viewer/superfan", label: "Superfans", owner: false, streamer: false, fan: true },
] as const satisfies readonly PersonaKeyedLink[];

export type MeForPersona = Pick<
  AuthMePayload,
  "role" | "signup_interested_server_owner" | "signup_interested_streamer" | "signup_interested_fan"
>;

function filterLinksBySignupPersonas(me: MeForPersona | null, links: readonly PersonaKeyedLink[]): PersonaKeyedLink[] {
  if (!me) return [...links];
  if (me.role === "super_admin" || me.role === "admin") return [...links];

  const owner = me.signup_interested_server_owner === true;
  const streamer = me.signup_interested_streamer === true;
  const fan = me.signup_interested_fan === true;
  if (!owner && !streamer && !fan) return [...links];

  return links.filter((link) => {
    if (owner && link.owner) return true;
    if (streamer && link.streamer) return true;
    if (fan && link.fan) return true;
    return false;
  });
}

/** Logged-in navigation filtered by signup personas. Staff roles see everything. */
export function filterNavLinksForUser(me: MeForPersona | null): readonly SiteNavLink[] {
  return filterLinksBySignupPersonas(me, SITE_NAV_LINKS) as SiteNavLink[];
}

export function filterDashboardFooterLinksForUser(me: MeForPersona | null): PersonaKeyedLink[] {
  return filterLinksBySignupPersonas(me, DASHBOARD_FOOTER_LINKS);
}

export type DashboardPersonaPanels = {
  /** Server list + RCON tools: owner signup, invited access (has servers), or staff. */
  serverAdmin: boolean;
  /** Add-server form: owners and staff only (not invite-only moderators). */
  showAddServerForm: boolean;
  streamer: boolean;
  fan: boolean;
};

/** Which dashboard (/servers) panels to show: isolated by signup intent; union when multiple; staff sees all. */
export function dashboardPersonaPanels(
  me: MeForPersona | null,
  opts: { authenticated: boolean; serverCount: number }
): DashboardPersonaPanels {
  if (!opts.authenticated || !me) {
    return { serverAdmin: false, showAddServerForm: false, streamer: false, fan: false };
  }
  if (me.role === "super_admin" || me.role === "admin") {
    return { serverAdmin: true, showAddServerForm: true, streamer: true, fan: true };
  }

  const legacyNoIntent =
    !me.signup_interested_server_owner &&
    !me.signup_interested_streamer &&
    !me.signup_interested_fan;
  if (legacyNoIntent) {
    return { serverAdmin: true, showAddServerForm: true, streamer: true, fan: true };
  }

  const ownerSignup = me.signup_interested_server_owner === true;
  return {
    serverAdmin: ownerSignup || opts.serverCount > 0,
    showAddServerForm: ownerSignup,
    streamer: me.signup_interested_streamer === true || me.role === "streamer",
    fan: me.signup_interested_fan === true,
  };
}
