import { NextResponse } from "next/server";

/**
 * Temporary early-access signup. Replace with GoHighLevel (or other CRM) integration later.
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

    // TODO: send to GoHighLevel / CRM when ready
    // For now just log and return success
    console.info("[early-access]", { name, email, message });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
