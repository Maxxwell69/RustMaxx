import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { submitViewerSiteApplication } from "@/lib/superfan";

export async function POST(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;

  let body: { message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message : "";

  const result = await submitViewerSiteApplication(session.userId, message);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await audit(session.userId, "viewer.superfan.site_apply", {}).catch(() => {});
  return NextResponse.json({ ok: true });
}
