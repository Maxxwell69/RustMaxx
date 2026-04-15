import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { hasApprovedRustmaxxStreamerApplication } from "@/lib/streamer-applications";
import { submitStreamerServerRequest } from "@/lib/streamer-server-requests";

/** Logged-in user with staff-approved streamer application submits a request to use TikFinity on this listed server. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = getSession(request.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!(await hasApprovedRustmaxxStreamerApplication(user.id, user.role))) {
    return NextResponse.json(
      {
        error:
          "Your RustMaxx streamer application must be approved before you can request access to servers. Complete it under Profile or /streamer/register.",
      },
      { status: 403 }
    );
  }

  const { id: serverId } = await params;
  let message: string | null = null;
  try {
    const body = await request.json();
    if (typeof body?.message === "string") message = body.message.trim() || null;
  } catch {
    /* empty body ok */
  }

  const result = await submitStreamerServerRequest(serverId, user.id, message);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    request: {
      id: result.row.id,
      status: result.row.status,
      message: result.row.message,
    },
  });
}
