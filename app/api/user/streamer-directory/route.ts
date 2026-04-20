import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { hasApprovedRustmaxxStreamerApplication } from "@/lib/streamer-applications";
import { coerceDirectorySocialsFromDb } from "@/lib/streamer-directory-socials";
import { findUserById, updateStreamerDirectoryFields } from "@/lib/users";
import { logoUrlForImgSrc } from "@/lib/upload-files";

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
    streamer_directory_socials?: Record<string, string> | null;
    streamer_directory_show_servers?: boolean;
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
  if (body.streamer_directory_show_servers !== undefined) {
    patch.streamer_directory_show_servers = Boolean(body.streamer_directory_show_servers);
  }
  if (body.streamer_directory_socials !== undefined) {
    if (body.streamer_directory_socials === null) {
      patch.streamer_directory_socials = null;
    } else if (typeof body.streamer_directory_socials === "object" && !Array.isArray(body.streamer_directory_socials)) {
      patch.streamer_directory_socials = body.streamer_directory_socials as Record<string, string>;
    } else {
      return NextResponse.json(
        { error: "streamer_directory_socials must be an object or null" },
        { status: 400 }
      );
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

  let result: Awaited<ReturnType<typeof updateStreamerDirectoryFields>>;
  try {
    result = await updateStreamerDirectoryFields(user.id, patch);
  } catch (e) {
    console.error("[streamer-directory PATCH]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 500 }
    );
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    streamer_directory_visible: result.user.streamer_directory_visible,
    streamer_directory_avatar_url: logoUrlForImgSrc(result.user.streamer_directory_avatar_url ?? null),
    streamer_directory_bio: result.user.streamer_directory_bio,
    streamer_directory_socials: coerceDirectorySocialsFromDb(result.user.streamer_directory_socials),
    streamer_directory_show_servers: result.user.streamer_directory_show_servers === true,
  });
}
