import { NextRequest, NextResponse } from "next/server";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import {
  deleteCrewRnpcRegistration,
  listCrewRnpcRegistrations,
} from "@/lib/crew-rnpc-registrations";

const TIKFINITY_SERVER_ID = process.env.TIKFINITY_SERVER_ID?.trim() ?? null;

/**
 * GET: List crew RNPC registrations (subscriber viewers registered on join). Admin only.
 */
export async function GET(request: NextRequest) {
  try {
    const authErr = await requireCanManageServersFromDb(request);
    if (authErr) return authErr;

    if (!TIKFINITY_SERVER_ID) {
      return NextResponse.json(
        { error: "TIKFINITY_SERVER_ID is not set", registrations: [] },
        { status: 200 }
      );
    }

    const limit = Math.min(
      1000,
      Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 500)
    );
    let registrations: Awaited<ReturnType<typeof listCrewRnpcRegistrations>> = [];
    try {
      registrations = await listCrewRnpcRegistrations(TIKFINITY_SERVER_ID, limit);
    } catch (e) {
      console.error("[tikfinity/crew-rnpc] list failed:", e);
    }

    return NextResponse.json({ registrations, serverId: TIKFINITY_SERVER_ID });
  } catch (e) {
    console.error("[tikfinity/crew-rnpc] GET failed:", e);
    return NextResponse.json(
      { error: "Failed to load crew registrations" },
      { status: 500 }
    );
  }
}

/**
 * DELETE: Remove one registration by id. Query: ?id=<uuid>. Admin only.
 */
export async function DELETE(request: NextRequest) {
  try {
    const authErr = await requireCanManageServersFromDb(request);
    if (authErr) return authErr;

    if (!TIKFINITY_SERVER_ID) {
      return NextResponse.json({ error: "TIKFINITY_SERVER_ID is not set" }, { status: 503 });
    }

    const id = request.nextUrl.searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "Query parameter id is required" }, { status: 400 });
    }

    const deleted = await deleteCrewRnpcRegistration(id, TIKFINITY_SERVER_ID);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[tikfinity/crew-rnpc] DELETE failed:", e);
    return NextResponse.json(
      { error: "Failed to remove registration" },
      { status: 500 }
    );
  }
}
