import { NextRequest, NextResponse } from "next/server";
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
import { canUsePerStreamerTikfinityWebhook } from "@/lib/streamer-guard";
import { getStreamerRuleByEventName } from "@/lib/streamer-tikfinity-rules";
import { getStreamerPolicyForServer } from "@/lib/streamer-action-policy";
import { isStreamerAllowedForServerHooks } from "@/lib/streamer-server-allowlist";

const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Opaque path secret (32 bytes hex) — no ?token= required. */
export const OPAQUE_HOOK_KEY_RE = /^[a-f0-9]{64}$/;

export function getHookToken(request: NextRequest): string | null {
  const q = request.nextUrl.searchParams.get("token")?.trim();
  if (q) return q;
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-rustmaxx-webhook-token")?.trim() ?? null;
}

export async function handleTikfinityHookRequest(
  request: NextRequest,
  segment: string,
  body: unknown
): Promise<NextResponse> {
  const raw = segment.trim();

  let hook =
    OPAQUE_HOOK_KEY_RE.test(raw)
      ? await getStreamerWebhookByHookKey(raw)
      : UUID_SEGMENT.test(raw)
        ? await getStreamerWebhookByPublicId(raw)
        : null;

  if (!hook) {
    return withCors(
      NextResponse.json({ ok: false, error: "Unknown webhook" }, { status: 404 })
    );
  }

  const usesOpaqueKey = OPAQUE_HOOK_KEY_RE.test(raw);

  if (!usesOpaqueKey) {
    const token = getHookToken(request);
    if (!token || !(await verifyWebhookSecret(token, hook.secret_hash))) {
      return withCors(
        NextResponse.json(
          {
            ok: false,
            error: "Invalid or missing webhook token",
            debug:
              "Use your one-line webhook URL from Streamer dashboard (includes secret in path), or append ?token=YOUR_SECRET, or send Authorization: Bearer YOUR_SECRET, or header X-Rustmaxx-Webhook-Token.",
          },
          { status: 401 }
        )
      );
    }
  }

  const user = await findUserById(hook.user_id);
  if (!user || !(await canUsePerStreamerTikfinityWebhook(user))) {
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "Streamer account not approved for TikFinity webhooks",
          debug:
            "RustMaxx staff must approve your streamer application (Admin → Streamer applications). Then the server owner enables streamer interactions for that server and selects which actions you may run.",
        },
        { status: 403 }
      )
    );
  }

  const policy = await getStreamerPolicyForServer(hook.server_id);
  if (!policy) {
    return withCors(
      NextResponse.json({ ok: false, error: "Server not found for this webhook." }, { status: 503 })
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
