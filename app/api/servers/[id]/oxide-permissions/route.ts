import { NextRequest, NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerWithRole, canManageServerAccess } from "@/lib/server-access";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";
import { audit } from "@/lib/audit";
import {
  buildOxidePermissionCommand,
  normalizeOxideGroupName,
  normalizeOxidePermission,
  normalizeSteamIdForOxide,
  type OxidePermSubject,
} from "@/lib/oxide-permission-rcon";

type Body = {
  action?: string;
  subject?: string;
  subjectId?: string;
  permission?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;

  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManageServerAccess(result.serverRole)) {
    return NextResponse.json(
      { error: "Only server owner or admin can grant or revoke Oxide permissions." },
      { status: 403 }
    );
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const actionRaw = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  const action = actionRaw === "grant" || actionRaw === "revoke" ? actionRaw : null;
  if (!action) {
    return NextResponse.json(
      { error: 'action must be "grant" or "revoke"' },
      { status: 400 }
    );
  }

  const subjectRaw = typeof body.subject === "string" ? body.subject.trim().toLowerCase() : "";
  const subject: OxidePermSubject | null =
    subjectRaw === "user" || subjectRaw === "group" ? subjectRaw : null;
  if (!subject) {
    return NextResponse.json(
      { error: 'subject must be "user" (Steam ID) or "group" (Oxide group name)' },
      { status: 400 }
    );
  }

  const permission = normalizeOxidePermission(typeof body.permission === "string" ? body.permission : "");
  if (!permission) {
    return NextResponse.json(
      {
        error:
          "permission must be a non-empty Oxide permission string (letters, digits, dots, underscores only).",
      },
      { status: 400 }
    );
  }

  const rawSubjectId = typeof body.subjectId === "string" ? body.subjectId.trim() : "";
  let subjectId: string | null = null;
  if (subject === "user") {
    subjectId = normalizeSteamIdForOxide(rawSubjectId);
    if (!subjectId) {
      return NextResponse.json(
        { error: "subjectId must be a numeric Steam ID (5–20 digits) for user grants." },
        { status: 400 }
      );
    }
  } else {
    subjectId = normalizeOxideGroupName(rawSubjectId);
    if (!subjectId) {
      return NextResponse.json(
        {
          error:
            "For groups, subjectId must be the Oxide group name (no spaces; letters, digits, - or _).",
        },
        { status: 400 }
      );
    }
    const { rows } = await query<{ id: string }>(
      "SELECT id FROM server_groups WHERE server_id = $1 AND name = $2",
      [serverId, subjectId]
    );
    if (!rows[0]) {
      return NextResponse.json(
        {
          error:
            "Unknown group for this server. Create the group under Permissions first so RustMaxx stays in sync with Oxide.",
        },
        { status: 400 }
      );
    }
  }

  if (!pool) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }

  const server = result.server;
  const connected = await ensureConnection(
    server.id,
    server.rcon_host,
    server.rcon_port,
    server.rcon_password,
    async () => {}
  );
  if (!connected.ok) {
    return NextResponse.json(
      { error: connected.error ?? "Could not connect to Rust server." },
      { status: 502 }
    );
  }

  const command = buildOxidePermissionCommand(action, subject, subjectId, permission);
  try {
    const response = await runAndWait(server.id, command, 12000);
    audit(session.userId, "oxide.permission", {
      serverId,
      action,
      subject,
      subjectId,
      permission,
    }).catch(() => {});
    return NextResponse.json({ ok: true, response: response ?? "" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[oxide-permissions]", serverId, command, message);
    return NextResponse.json({ error: message || "RCON command failed." }, { status: 502 });
  }
}
