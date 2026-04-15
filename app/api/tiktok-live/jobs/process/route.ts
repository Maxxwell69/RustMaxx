import { NextRequest, NextResponse } from "next/server";
import { processDueEventJobs, tiktokDirectEnabled } from "@/lib/tiktok-live";
import { requireCanManageServersFromDb } from "@/lib/api-auth";

/** Manual/cron job runner for queued TikTok direct events. */
export async function POST(request: NextRequest) {
  if (!tiktokDirectEnabled()) {
    return NextResponse.json({ error: "TikTok direct integration disabled" }, { status: 503 });
  }
  const authErr = await requireCanManageServersFromDb(request);
  if (authErr) return authErr;
  let limit = 25;
  try {
    const body = (await request.json()) as { limit?: number };
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.max(1, Math.min(200, Math.trunc(body.limit)));
    }
  } catch {
    // optional body
  }
  const out = await processDueEventJobs(limit);
  return NextResponse.json({ ok: true, ...out, limit });
}
