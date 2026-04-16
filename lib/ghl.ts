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

type GhlContactCreateInput = {
  email: string;
  firstName: string;
  lastName?: string;
  tags: string[];
  note?: string | null;
};

/**
 * Creates a contact in GHL and optionally adds a note.
 */
async function ghlCreateContactWithOptionalNote(
  input: GhlContactCreateInput
): Promise<GhlSyncResult> {
  if (!isGhlConfigured()) {
    return { ok: false, error: "GHL not configured (missing token or location id)" };
  }
  const locationId = ghlLocationId()!;
  const email = input.email.trim().toLowerCase();

  const body: Record<string, unknown> = {
    locationId,
    email,
    firstName: input.firstName,
    tags: input.tags,
  };
  if (input.lastName) body.lastName = input.lastName;

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

  const note = input.note?.trim();
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

/**
 * Creates a contact in GHL and optionally adds a note with the early-access message.
 */
export async function ghlSyncEarlyAccessLead(input: GhlEarlyAccessPayload): Promise<GhlSyncResult> {
  const { firstName, lastName } = splitName(input.name);
  return ghlCreateContactWithOptionalNote({
    email: input.email,
    firstName,
    lastName: lastName || undefined,
    tags: ["rustmaxx", "early-access"],
    note: input.message || null,
  });
}

export type GhlSignupPayload = {
  email: string;
  displayName: string | null;
  interestedServerOwner: boolean;
  interestedStreamer: boolean;
  interestedFan: boolean;
};

/**
 * Creates or updates CRM context for a new RustMaxx account (same email as login).
 * Tags: rustmaxx, signup; optional server-owner / streamer for workflows in GHL.
 */
export async function ghlSyncSignupContact(input: GhlSignupPayload): Promise<GhlSyncResult> {
  const nameSource = (input.displayName ?? "").trim() || input.email.split("@")[0] || "User";
  const { firstName, lastName } = splitName(nameSource);
  const tags = ["rustmaxx", "signup"];
  if (input.interestedServerOwner) tags.push("server-owner");
  if (input.interestedStreamer) tags.push("streamer");
  if (input.interestedFan) tags.push("fan");

  const lines = [
    "Source: RustMaxx sign up",
    `Server owner interest: ${input.interestedServerOwner ? "yes" : "no"}`,
    `Streamer interest: ${input.interestedStreamer ? "yes" : "no"}`,
    `Viewer / superfan interest: ${input.interestedFan ? "yes" : "no"}`,
  ];
  const note = lines.join("\n");

  return ghlCreateContactWithOptionalNote({
    email: input.email,
    firstName,
    lastName: lastName || undefined,
    tags,
    note,
  });
}
