import { NextRequest, NextResponse } from "next/server";
import { parseTikfinityWebhookBody } from "@/lib/tikfinity";
import {
  runTikfinityWebhook,
  withCors,
} from "@/lib/tikfinity-webhook-run";
import {
  getStreamerWebhookByHookKey,
  getStreamerWebhookByPublicId,
  verifyWebhookSecret,
} from "@/lib/streamer-webhooks";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { getStreamerRuleByEventName } from "@/lib/streamer-tikfinity-rules";
import { getStreamerPolicyForServer } from "@/lib/streamer-action-policy";
import { isStreamerAllowedForServerHooks } from "@/lib/streamer-server-allowlist";

const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Opaque path secret (32 bytes hex) — no ?token= required. */
const OPAQUE_HOOK_KEY = /^[a-f0-9]{64}$/;

function getHookToken(request: NextRequest): string | null {
  const q = request.nextUrl.searchParams.get("token")?.trim();
  if (q) return q;
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-rustmaxx-webhook-token")?.trim() ?? null;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ segment: string }> }
) {
  return handleHook(request, context, {});
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ segment: string }> }
) {
  let body: unknown;
  try {
    const text = await request.text();
    const ct = request.headers.get("content-type");
    body = parseTikfinityWebhookBody(text, ct);
  } catch {
    body = {};
  }
  return handleHook(request, context, body);
}

async function handleHook(
  request: NextRequest,
  context: { params: Promise<{ segment: string }> },
  body: unknown
) {
  const { segment: raw } = await context.params;
  const segment = raw.trim();

  let hook =
    OPAQUE_HOOK_KEY.test(segment)
      ? await getStreamerWebhookByHookKey(segment)
      : UUID_SEGMENT.test(segment)
        ? await getStreamerWebhookByPublicId(segment)
        : null;

  if (!hook) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "Unknown webhook" },
        { status: 404 }
      )
    );
  }

  const usesOpaqueKey = OPAQUE_HOOK_KEY.test(segment);

  if (!usesOpaqueKey) {
    const token = getHookToken(request);
    if (!token || !(await verifyWebhookSecret(token, hook.secret_hash))) {
      return withCors(
        NextResponse.json(
          {
            ok: false,
            error: "Invalid or missing webhook token",
            debug:
              "Use your one-line webhook URL from Streamer dashboard (includes secret in the path), or append ?token=YOUR_SECRET, or send Authorization: Bearer YOUR_SECRET, or header X-Rustmaxx-Webhook-Token.",
          },
          { status: 401 }
        )
      );
    }
  }

  const user = await findUserById(hook.user_id);
  if (!user || !canAccessStreamerDashboard(user)) {
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "Streamer subscription inactive or account not eligible",
          debug:
            "Renew your plan in RustMaxx → Streamer dashboard, or contact support.",
        },
        { status: 403 }
      )
    );
  }

  const policy = await getStreamerPolicyForServer(hook.server_id);
  if (!policy) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "Server not found for this webhook." },
        { status: 503 }
      )
    );
  }
  if (!policy.enabled) {
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "Streamer interactions are disabled for this server.",
          debug:
            "The server owner must enable streamer access under RustMaxx → Servers → this server → Streamer interactions.",
        },
        { status: 403 }
      )
    );
  }

  if (!(await isStreamerAllowedForServerHooks(hook.server_id, hook.user_id))) {
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "This streamer is not allowed to use TikFinity on this server.",
          debug:
            "The owner may require approval (public server list request) or an allowlist entry under Servers → this server → Streamer interactions.",
        },
        { status: 403 }
      )
    );
  }

  return runTikfinityWebhook(request, body, {
    serverId: hook.server_id,
    resolveConnectionByEventName: (name) =>
      getStreamerRuleByEventName(hook.id, name),
    streamerAllowedActions: policy.effectiveActions,
    streamerProfileSteam64: user.steam_id,
  });
}
