/**
 * Three membership tiers set by admins (separate from global role and billing).
 * Names: Standard → Pro → Elite (clear SaaS-style progression).
 */

export const MEMBERSHIP_LEVELS = ["standard", "pro", "elite"] as const;

export type MembershipLevel = (typeof MEMBERSHIP_LEVELS)[number];

export const MEMBERSHIP_LEVEL_LABELS: Record<MembershipLevel, string> = {
  standard: "Standard",
  pro: "Pro",
  elite: "Elite",
};

export function parseMembershipLevel(raw: unknown): MembershipLevel | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (MEMBERSHIP_LEVELS as readonly string[]).includes(v)
    ? (v as MembershipLevel)
    : null;
}

export function defaultMembershipLevel(): MembershipLevel {
  return "standard";
}
