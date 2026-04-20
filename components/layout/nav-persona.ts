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
  { href: "/superfans", label: "Fans & superfans", owner: true, streamer: true, fan: true },
  {
    href: "/streamer",
    label: "Streamer setup",
    owner: false,
    streamer: true,
    fan: false,
  },
  { href: "/features", label: "Features", owner: true, streamer: true, fan: true },
  { href: "/games", label: "Games", owner: true, streamer: true, fan: true },
  { href: "/plugins", label: "Plugins", owner: true, streamer: true, fan: true },
] as const satisfies readonly PersonaKeyedLink[];

export type SiteNavLink = (typeof SITE_NAV_LINKS)[number];

/** Dashboard footer quick links (same persona rules as main nav). */
export const DASHBOARD_FOOTER_LINKS = [
  { href: "/servers", label: "Servers dashboard", owner: true, streamer: false, fan: false },
  { href: "/server-list", label: "Public server list", owner: true, streamer: false, fan: false },
  { href: "/streamers", label: "Public streamers", owner: false, streamer: true, fan: true },
  {
    href: "/streamer",
    label: "Streamer setup",
    owner: false,
    streamer: true,
    fan: false,
  },
  { href: "/superfans", label: "Fans & superfans", owner: true, streamer: true, fan: true },
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
  /** Server list + RCON: only if user signed up as server owner (not streamer-only). Staff always. */
  serverAdmin: boolean;
  /** Add-server form: owner signup or staff only. */
  showAddServerForm: boolean;
  streamer: boolean;
  fan: boolean;
};

/** Which dashboard (/servers) panels to show: isolated by signup intent; union when multiple; staff sees all. */
export function dashboardPersonaPanels(
  me: MeForPersona | null,
  opts: { authenticated: boolean }
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
    if (me.role === "streamer") {
      return { serverAdmin: false, showAddServerForm: false, streamer: true, fan: false };
    }
    return { serverAdmin: true, showAddServerForm: true, streamer: true, fan: true };
  }

  const ownerSignup = me.signup_interested_server_owner === true;
  return {
    serverAdmin: ownerSignup,
    showAddServerForm: ownerSignup,
    streamer: me.signup_interested_streamer === true || me.role === "streamer",
    fan: me.signup_interested_fan === true,
  };
}

/** Bottom-of-dashboard CTAs: offer applications for personas not yet chosen (not staff / not legacy-all). */
export function explorePersonaCtas(me: MeForPersona | null): {
  showStreamer: boolean;
  showFan: boolean;
} | null {
  if (!me) return null;
  if (me.role === "super_admin" || me.role === "admin") return { showStreamer: false, showFan: false };

  const legacyNoIntent =
    !me.signup_interested_server_owner &&
    !me.signup_interested_streamer &&
    !me.signup_interested_fan;
  if (legacyNoIntent) return { showStreamer: false, showFan: false };

  const hasStreamerPath =
    me.signup_interested_streamer === true || me.role === "streamer";
  const hasFanPath = me.signup_interested_fan === true;
  return {
    showStreamer: !hasStreamerPath,
    showFan: !hasFanPath,
  };
}

/** Short line for dashboard header: what personas this account is aligned with. */
export function activePersonaSummary(me: MeForPersona | null): string | null {
  if (!me) return null;
  if (me.role === "super_admin" || me.role === "admin") {
    return "Staff account — all dashboard sections and nav links are available.";
  }
  const legacyNoIntent =
    !me.signup_interested_server_owner &&
    !me.signup_interested_streamer &&
    !me.signup_interested_fan;
  if (legacyNoIntent) {
    if (me.role === "streamer") {
      return "Streamer-focused account (created before signup choices). Streamer tools apply; use Add more below if you also want fan or server tools.";
    }
    return "Legacy account (no signup personas on file) — all tool areas are shown. You can narrow this by choosing Add more below.";
  }
  const parts: string[] = [];
  if (me.signup_interested_server_owner) parts.push("Server admin");
  if (me.signup_interested_streamer === true || me.role === "streamer") parts.push("Streamer");
  if (me.signup_interested_fan) parts.push("Fan / viewer");
  if (parts.length === 0) return "No persona flags matched — use Profile or the actions below.";
  return `Your account is set up for: ${parts.join(" · ")}.`;
}
