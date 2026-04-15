import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { parseStreamerApplicationPayload } from "@/lib/streamer-application-payload";
import {
  getStreamerApplicationByUserId,
  upsertStreamerApplication,
} from "@/lib/streamer-applications";

function iso(d: Date | string | null | undefined): string {
  if (d == null) return new Date().toISOString();
  if (typeof d === "string") return d;
  if (d instanceof Date) return d.toISOString();
  return new Date().toISOString();
}

function serialize(row: Awaited<ReturnType<typeof getStreamerApplicationByUserId>>) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    legal_name: row.legal_name,
    preferred_stream_name: row.preferred_stream_name,
    tiktok_url: row.tiktok_url,
    twitch_url: row.twitch_url,
    kick_url: row.kick_url,
    youtube_url: row.youtube_url,
    twitter_url: row.twitter_url,
    instagram_url: row.instagram_url,
    discord_username: row.discord_username,
    other_socials: row.other_socials,
    avg_live_viewers: row.avg_live_viewers,
    stream_schedule: row.stream_schedule,
    content_summary: row.content_summary,
    why_rustmaxx: row.why_rustmaxx,
    status: row.status,
    reviewed_at: row.reviewed_at == null ? null : iso(row.reviewed_at),
    admin_notes: row.status === "rejected" ? row.admin_notes : null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

/** Current user's streamer application (or null). */
export async function GET(request: NextRequest) {
  const err = requireSession(request);
  if (err) return err;
  const session = getSessionFromRequest(request)!;
  try {
    const row = await getStreamerApplicationByUserId(session.userId);
    return NextResponse.json({ application: serialize(row) });
  } catch (e) {
    console.error("[streamer-application] GET failed:", e);
    return NextResponse.json(
      { error: "Could not load application.", application: null },
      { status: 500 }
    );
  }
}

/** Create or update application (pending / resubmit after rejection). */
export async function POST(request: NextRequest) {
  const err = requireSession(request);
  if (err) return err;
  const session = getSessionFromRequest(request)!;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseStreamerApplicationPayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await upsertStreamerApplication(session.userId, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await audit(session.userId, "streamer_application_upsert", {
      application_id: result.row.id,
      status: result.row.status,
    }).catch(() => {});

    return NextResponse.json({ ok: true, application: serialize(result.row) });
  } catch (e) {
    console.error("[streamer-application] POST failed:", e);
    return NextResponse.json(
      { error: "Could not save your application. If this persists, contact support." },
      { status: 500 }
    );
  }
}
