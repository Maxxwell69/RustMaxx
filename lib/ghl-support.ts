/**
 * GoHighLevel — support intake (contact + tags + structured note).
 * Reuses {@link ghlCreateContactWithOptionalNote} from ./ghl.
 */

import { ghlCreateContactWithOptionalNote, type GhlSyncResult } from "./ghl";

export type SupportAudience = "server-admin" | "streamer" | "viewer";

export type SupportChannel = "web" | "email";

export type SupportPriority = "low" | "normal" | "high";

export type GhlSupportIntakePayload = {
  /** Who the request is for (routing + tags). */
  audience: SupportAudience;
  /** Where the ticket originated (web form vs forwarded email workflow). */
  channel: SupportChannel;
  email: string;
  name: string;
  subject: string;
  message: string;
  /** Optional RustMaxx server id from dashboard context. */
  serverId?: string | null;
  /** Optional streamer / account identifier if known. */
  streamerId?: string | null;
  priority: SupportPriority;
  /** e.g. contact-form */
  source: string;
};

function splitName(full: string): { firstName: string; lastName: string } {
  const t = full.trim();
  if (!t) return { firstName: "Support", lastName: "User" };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

function audienceTag(audience: SupportAudience): string {
  const map: Record<SupportAudience, string> = {
    "server-admin": "server-admin",
    streamer: "streamer",
    viewer: "viewer",
  };
  return map[audience];
}

/**
 * Creates/updates CRM visibility via contact POST + tags + a single note with full context.
 * Pipeline/stage are expected to be driven by GHL workflows on these tags (see runbook).
 */
export async function ghlSyncSupportIntake(input: GhlSupportIntakePayload): Promise<GhlSyncResult> {
  const { firstName, lastName } = splitName(input.name);
  const tags = [
    "rustmaxx",
    "support",
    audienceTag(input.audience),
    `channel-${input.channel}`,
    `priority-${input.priority}`,
  ];

  const lines = [
    "RustMaxx support intake",
    "---",
    `Subject: ${input.subject.trim() || "(no subject)"}`,
    `Audience: ${input.audience}`,
    `Channel: ${input.channel}`,
    `Priority: ${input.priority}`,
    `Source: ${input.source}`,
  ];
  if (input.serverId?.trim()) lines.push(`Server ID: ${input.serverId.trim()}`);
  if (input.streamerId?.trim()) lines.push(`Streamer / account ref: ${input.streamerId.trim()}`);
  lines.push("---", "Message:", input.message.trim() || "(empty)");

  const note = lines.join("\n");

  return ghlCreateContactWithOptionalNote({
    email: input.email,
    firstName,
    lastName: lastName || undefined,
    tags,
    note,
  });
}
