/**
 * GoHighLevel (LeadConnector) CRM — server-side only.
 * Uses a private integration token + location id from env.
 */

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

function trimEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/** Private integration API key (Bearer). */
function ghlPrivateToken(): string | undefined {
  return (
    trimEnv("GHL_PRIVATE_INTEGRATION_KEY") ??
    trimEnv("ghl_Private_Integration_Key") ??
    trimEnv("ghl_api_key") ??
    trimEnv("GHL_API_KEY")
  );
}

/** Sub-account / location id (required on most contact calls). */
function ghlLocationId(): string | undefined {
  return trimEnv("ghl_Location_ID") ?? trimEnv("GHL_LOCATION_ID");
}

export function isGhlConfigured(): boolean {
  return Boolean(ghlPrivateToken() && ghlLocationId());
}

function splitName(full: string): { firstName: string; lastName: string } {
  const t = full.trim();
  if (!t) return { firstName: "RustMaxx", lastName: "Lead" };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

async function ghlFetch(path: string, init: RequestInit): Promise<Response> {
  const token = ghlPrivateToken();
  if (!token) throw new Error("GHL token not configured");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Version", GHL_API_VERSION);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(`${GHL_BASE}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export type GhlEarlyAccessPayload = {
  email: string;
  name: string;
  message: string;
};

export type GhlSyncResult =
  | { ok: true; contactId?: string }
  | { ok: false; error: string; status?: number };

/**
 * Creates a contact in GHL and optionally adds a note with the early-access message.
 */
export async function ghlSyncEarlyAccessLead(input: GhlEarlyAccessPayload): Promise<GhlSyncResult> {
  if (!isGhlConfigured()) {
    return { ok: false, error: "GHL not configured (missing token or location id)" };
  }
  const locationId = ghlLocationId()!;
  const { firstName, lastName } = splitName(input.name);
  const email = input.email.trim().toLowerCase();

  const body: Record<string, unknown> = {
    locationId,
    email,
    firstName,
    tags: ["rustmaxx", "early-access"],
  };
  if (lastName) body.lastName = lastName;

  let res: Response;
  try {
    res = await ghlFetch("/contacts/", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Request failed";
    return { ok: false, error: msg };
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    const errObj = data as { message?: string };
    const msg = errObj?.message ?? (text.slice(0, 200) || res.statusText);
    return { ok: false, error: msg, status: res.status };
  }

  const d = data as { contact?: { id?: string }; id?: string };
  const contactId = d.contact?.id ?? d.id;

  const note = input.message?.trim();
  if (note && contactId) {
    try {
      const noteRes = await ghlFetch(`/contacts/${contactId}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: note }),
      });
      if (!noteRes.ok) {
        console.warn("[ghl] contact created but note failed:", noteRes.status, await noteRes.text().catch(() => ""));
      }
    } catch (e) {
      console.warn("[ghl] contact created but note request failed:", e);
    }
  }

  return { ok: true, contactId };
}
