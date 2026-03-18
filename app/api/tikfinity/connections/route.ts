import { NextRequest, NextResponse } from "next/server";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import {
  createTikfinityConnection,
  deleteTikfinityConnection,
  listTikfinityConnections,
} from "@/lib/tikfinity-connections";
import type { TikTriggerAction } from "@/lib/tikfinity";

/**
 * GET: List TikFinity connections. Admin only.
 */
export async function GET(request: NextRequest) {
  try {
    const authErr = await requireCanManageServersFromDb(request);
    if (authErr) return authErr;
    const connections = await listTikfinityConnections();
    return NextResponse.json(connections);
  } catch (e) {
    console.error("[tikfinity/connections] GET failed:", e);
    return NextResponse.json(
      { error: "Failed to load connections", debug: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/**
 * POST: Create a TikFinity connection (event name → server action, optional message + scrap). Admin only.
 * Body: { name: string, serverAction: TikTriggerAction, message?: string, scrapAmount?: number }
 */
export async function POST(request: NextRequest) {
  try {
    const authErr = await requireCanManageServersFromDb(request);
    if (authErr) return authErr;

    let body: { name?: string; serverAction?: string; message?: string; scrapAmount?: number };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const serverAction = body.serverAction as TikTriggerAction | undefined;
    const message = body.message != null ? String(body.message) : undefined;
    const scrapAmount = body.scrapAmount != null ? Number(body.scrapAmount) : undefined;
    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }
    if (!serverAction) {
      return NextResponse.json(
        { error: "serverAction is required" },
        { status: 400 }
      );
    }

    const result = await createTikfinityConnection(name, serverAction, { message, scrapAmount });
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "A connection with this name already exists" ? 409 : 400 }
      );
    }
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[tikfinity/connections] POST failed:", e);
    return NextResponse.json(
      { error: "Failed to create connection", debug: msg },
      { status: 500 }
    );
  }
}

/**
 * DELETE: Remove a TikFinity connection by id. Admin only.
 * Query: ?id=<uuid>
 */
export async function DELETE(request: NextRequest) {
  try {
    const authErr = await requireCanManageServersFromDb(request);
    if (authErr) return authErr;

    const id = request.nextUrl.searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json(
        { error: "Query parameter id is required" },
        { status: 400 }
      );
    }

    const { deleted } = await deleteTikfinityConnection(id);
    if (!deleted) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[tikfinity/connections] DELETE failed:", e);
    return NextResponse.json(
      { error: "Failed to delete connection", debug: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
