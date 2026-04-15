import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { hasApprovedRustmaxxStreamerApplication } from "@/lib/streamer-applications";
import { findUserById, updateStreamerDirectoryFields } from "@/lib/users";

/** Update public directory visibility, avatar URL, and bio (own profile only). */
export async function PATCH(request: NextRequest) {
  const err = requireSession(request);
  if (err) return err;
  const session = getSessionFromRequest(request)!;
  const user = await findUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: {
    streamer_directory_visible?: boolean;
    streamer_directory_avatar_url?: string | null;
    streamer_directory_bio?: string | null;
  } = {};

  if (body.streamer_directory_visible !== undefined) {
    patch.streamer_directory_visible = Boolean(body.streamer_directory_visible);
  }
  if (body.streamer_directory_avatar_url !== undefined) {
    patch.streamer_directory_avatar_url =
      body.streamer_directory_avatar_url === null
        ? null
        : typeof body.streamer_directory_avatar_url === "string"
          ? body.streamer_directory_avatar_url
          : undefined;
    if (patch.streamer_directory_avatar_url === undefined && body.streamer_directory_avatar_url !== undefined) {
      return NextResponse.json({ error: "streamer_directory_avatar_url must be string or null" }, { status: 400 });
    }
  }
  if (body.streamer_directory_bio !== undefined) {
    if (body.streamer_directory_bio === null) {
      patch.streamer_directory_bio = null;
    } else if (typeof body.streamer_directory_bio === "string") {
      patch.streamer_directory_bio = body.streamer_directory_bio;
    } else {
      return NextResponse.json({ error: "streamer_directory_bio must be string or null" }, { status: 400 });
    }
  }

  if (patch.streamer_directory_visible === true) {
    const ok = await hasApprovedRustmaxxStreamerApplication(user.id, user.role);
    if (!ok) {
      return NextResponse.json(
        {
          error:
            "Your RustMaxx streamer application must be approved by staff before you can appear in the public directory.",
        },
        { status: 403 }
      );
    }
  }

  const result = await updateStreamerDirectoryFields(user.id, patch);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    streamer_directory_visible: result.user.streamer_directory_visible,
    streamer_directory_avatar_url: result.user.streamer_directory_avatar_url,
    streamer_directory_bio: result.user.streamer_directory_bio,
  });
}
