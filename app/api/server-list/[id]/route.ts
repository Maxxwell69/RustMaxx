import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { hasApprovedRustmaxxStreamerApplication } from "@/lib/streamer-applications";
import { getStreamerServerRequestByPair } from "@/lib/streamer-server-requests";

type ListedServerRow = {
  id: string;
  name: string;
  listing_name: string | null;
  listing_description: string | null;
  game_host: string | null;
  game_port: number | null;
  location: string | null;
  logo_url: string | null;
  listed: boolean;
  streamer_interactions_enabled: boolean;
  streamer_join_requires_owner_approval: boolean;
  owner_id: string | null;
};

/**
 * Public server detail (listed servers only). Optional session adds request / eligibility hints.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: serverId } = await params;
  const { rows } = await query<ListedServerRow>(
    `SELECT id, name, listing_name, listing_description, game_host, game_port, location, logo_url, listed,
            streamer_interactions_enabled,
            COALESCE(streamer_join_requires_owner_approval, false) AS streamer_join_requires_owner_approval,
            owner_id
     FROM servers WHERE id = $1 AND listed = true LIMIT 1`,
    [serverId]
  );
  const s = rows[0];
  if (!s) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { owner_id, ...publicFields } = s;

  const session = getSession(request.headers.get("cookie"));
  let viewer:
    | {
        loggedIn: boolean;
        applicationApproved: boolean;
        canRequest: boolean;
        request: { status: string; message: string | null } | null;
        reason?: string;
      }
    | undefined;

  if (session) {
    const user = await findUserById(session.userId);
    const applicationApproved = user
      ? await hasApprovedRustmaxxStreamerApplication(user.id, user.role)
      : false;
    const reqRow = await getStreamerServerRequestByPair(serverId, session.userId);
    const requestPayload = reqRow
      ? { status: reqRow.status, message: reqRow.message }
      : null;

    let canRequest = false;
    let reason: string | undefined;
    if (!applicationApproved) {
      reason =
        "Your RustMaxx streamer application must be approved by staff before you can request access to servers.";
    } else if (!s.streamer_interactions_enabled) {
      reason = "This server does not have streamer interactions enabled yet.";
    } else if (!s.streamer_join_requires_owner_approval) {
      reason =
        "This server does not use access requests. Eligible streamers can add it from the Streamer dashboard unless the owner uses an allowlist.";
      canRequest = false;
    } else if (owner_id && owner_id === session.userId) {
      reason = "You manage this server already.";
    } else if (reqRow?.status === "pending") {
      reason = "You already have a pending request.";
    } else if (reqRow?.status === "approved") {
      reason = "You are already approved for this server.";
    } else {
      canRequest = true;
    }

    viewer = {
      loggedIn: true,
      applicationApproved,
      canRequest,
      request: requestPayload,
      reason,
    };
  }

  return NextResponse.json({ server: publicFields, viewer });
}
