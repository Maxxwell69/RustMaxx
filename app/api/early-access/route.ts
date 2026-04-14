import { NextResponse } from "next/server";
import { ghlSyncEarlyAccessLead, isGhlConfigured } from "@/lib/ghl";

/**
 * Early-access signup: logs locally and syncs to GoHighLevel when env is set.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    const message = String(body.message ?? "").trim();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    console.info("[early-access]", { name, email, message: message ? "(has message)" : "" });

    if (isGhlConfigured()) {
      const ghl = await ghlSyncEarlyAccessLead({ email, name, message });
      if (!ghl.ok) {
        console.error("[early-access] GHL sync failed:", ghl.error, ghl.status ?? "");
      } else {
        console.info("[early-access] GHL contact ok", ghl.contactId ?? "");
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
