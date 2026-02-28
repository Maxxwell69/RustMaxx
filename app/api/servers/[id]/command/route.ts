import { NextRequest, NextResponse } from "next/server";
import { sendCommand } from "@/lib/rcon-manager";
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
  const result = sendCommand(serverId, command);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 502 });
  }
  await audit("admin", "command", { serverId, command });
  return NextResponse.json({ ok: true });
}
