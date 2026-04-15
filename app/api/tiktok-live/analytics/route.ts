import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession, requireCanManageServersFromDb } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { tiktokDirectEnabled, isUuidLike } from "@/lib/tiktok-live";

export async function GET(request: NextRequest) {
  if (!tiktokDirectEnabled()) {
    return NextResponse.json({ error: "TikTok direct integration disabled" }, { status: 503 });
  }
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const canAdmin = !(await requireCanManageServersFromDb(request));
  const serverId = request.nextUrl.searchParams.get("serverId")?.trim() ?? "";
  const daysRaw = Number(request.nextUrl.searchParams.get("days") ?? "30");
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, Math.trunc(daysRaw))) : 30;

  const vals: unknown[] = [session.userId, days];
  let i = 3;
  let where =
    `WHERE a.day >= (current_date - ($2::int || ' days')::interval)::date
       AND (a.user_id = $1::uuid OR s.owner_id = $1::uuid
            OR EXISTS (SELECT 1 FROM server_users su WHERE su.server_id = a.server_id AND su.user_id = $1::uuid)`;
  if (canAdmin) where += ` OR true`;
  where += `)`;
  if (serverId) {
    if (!isUuidLike(serverId)) return NextResponse.json({ error: "Invalid serverId" }, { status: 400 });
    where += ` AND a.server_id = $${i++}::uuid`;
    vals.push(serverId);
  }
  const totalsQ = await query<{ events: string; value: string; processed: string; failed: string }>(
    `SELECT
       COALESCE(sum(events_count), 0)::text AS events,
       COALESCE(sum(total_value), 0)::text AS value,
       COALESCE(sum(processed_count), 0)::text AS processed,
       COALESCE(sum(failed_count), 0)::text AS failed
     FROM tiktok_event_analytics_daily a
     JOIN servers s ON s.id = a.server_id
     ${where}`,
    vals
  );
  const topEventsQ = await query(
    `SELECT event_type, COALESCE(event_name, '(none)') AS event_name,
            sum(events_count)::int AS events_count, sum(total_value)::int AS total_value
     FROM tiktok_event_analytics_daily a
     JOIN servers s ON s.id = a.server_id
     ${where}
     GROUP BY event_type, COALESCE(event_name, '(none)')
     ORDER BY sum(events_count) DESC, sum(total_value) DESC
     LIMIT 20`,
    vals
  );
  const byDayQ = await query(
    `SELECT a.day::text, sum(events_count)::int AS events_count, sum(total_value)::int AS total_value,
            sum(processed_count)::int AS processed_count, sum(failed_count)::int AS failed_count
     FROM tiktok_event_analytics_daily a
     JOIN servers s ON s.id = a.server_id
     ${where}
     GROUP BY a.day
     ORDER BY a.day DESC
     LIMIT 120`,
    vals
  );
  const t = totalsQ.rows[0] ?? { events: "0", value: "0", processed: "0", failed: "0" };
  return NextResponse.json({
    totals: {
      events: Number.parseInt(t.events, 10) || 0,
      value: Number.parseInt(t.value, 10) || 0,
      processed: Number.parseInt(t.processed, 10) || 0,
      failed: Number.parseInt(t.failed, 10) || 0,
    },
    topEvents: topEventsQ.rows,
    byDay: byDayQ.rows,
  });
}
