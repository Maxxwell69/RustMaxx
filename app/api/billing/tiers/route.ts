import { NextResponse } from "next/server";
import { getPublishedBillingTiersApiPayload } from "@/lib/pricing-packages";

/** Public tier catalog from DB (super_admin editable); falls back to defaults if table empty or missing. */
export async function GET() {
  const payload = await getPublishedBillingTiersApiPayload();
  return NextResponse.json(payload);
}
