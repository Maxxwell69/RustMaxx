# TikTok Live Direct Setup

This mode ingests TikTok events directly (gift/like/follow/share/chat/join) without relying on TikFinity webhooks.

## 1) Enable feature flags

Set:

- `TIKTOK_DIRECT_ENABLED=true`
- `TIKTOK_INGEST_SECRET=<long random secret>`

## 2) Apply migration

Run:

- `npm run migrate`

This creates:

- `tiktok_live_connections`
- `tiktok_event_boards`
- `tiktok_event_mappings`
- `tiktok_live_events`
- `tiktok_event_jobs`
- `tiktok_event_analytics_daily`

## 3) Run worker

Install dependency (already in package.json):

- `tiktok-live-connector`

Start:

- `npm run tiktok:worker`

Worker env:

- `DATABASE_URL` (reads active direct connections)
- `TIKTOK_INGEST_SECRET` (HMAC signing)
- `TIKTOK_INGEST_URL` (defaults to `/api/tiktok-live/ingest`)
- `TIKTOK_WORKER_POLL_MS` (defaults to 30000)

## 4) Configure connections + boards

- Streamer UI: `/streamer/tiktok-live`
- Admin UI: `/admin/tiktok-live`

Connections define channel/server bindings. Boards + mappings define event-to-action behavior.

## 5) Processing + retries

- Ingest inserts event + queue job.
- API can process immediately on ingest.
- Retry queue endpoint: `POST /api/tiktok-live/jobs/process` (admin/super_admin only)
- Failed jobs backoff for 30 seconds and move to `dead` after repeated failures.

## 6) Rollout strategy

1. Enable feature flag in staging only.
2. Add one internal streamer connection.
3. Confirm event ingest and action dispatch in `/streamer/tiktok-live`.
4. Keep TikFinity routes active as fallback while direct mode stabilizes.
5. Enable per streamer cohort in production.
