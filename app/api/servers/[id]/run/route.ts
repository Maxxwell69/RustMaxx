import { NextRequest, NextResponse } from "next/server";
import { runAndWait } from "@/lib/rcon-manager";
import { audit } from "@/lib/audit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: serverId } = await params;
  let body: { command?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) {
    return NextResponse.json({ error: "command is required" }, { status: 400 });
  }
  try {
    const response = await runAndWait(serverId, command, 8000);
    audit("admin", "command.run", { serverId, command }).catch(() => {});
    return NextResponse.json({ ok: true, response });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

