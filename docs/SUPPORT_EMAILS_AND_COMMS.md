# Support emails & communication model

Operational runbook for **RustMaxx** support: audience inboxes, intake rules, GoHighLevel (GHL) routing, and **internal vs external** communication boundaries.

## Audience support addresses

Configure these in your environment (see [`.env.example`](../.env.example)). Defaults below use the production domain pattern; replace with your real aliases if different.

| Audience        | Purpose                         | Suggested alias              | Primary owner (triage)   |
|----------------|----------------------------------|------------------------------|---------------------------|
| **Server admins** | RCON, servers, billing, infra | `server-admins@rustmaxx.com` | Platform / ops            |
| **Streamers**   | TikFinity, overlays, stream tools | `streamers@rustmaxx.com`   | Creator success / support |
| **Viewers**     | General product, account, bugs | `viewers@rustmaxx.com`       | General support           |

**Ownership**

- **First response** within **1 business day** for all audiences (target SLA; adjust per staffing).
- **Server admins** issues affecting live servers or security: treat as **high** priority when confirmed; escalate to on-call if defined.
- **Escalation path**: L1 triage → L2 (engineering or integrations) → **internal** incident channel if service-wide.

**One inbox vs three**

- **Recommended:** separate aliases (above) so email rules and GHL forwarding can tag by audience without guessing from subject lines.
- **Alternative:** one mailbox (e.g. `support@…`) plus subject prefixes or GHL rules; document the rule set in GHL and keep env vars aligned with whatever you publish on `/contact`.

## Intake rules

### Web form (`/contact`)

- Required: **name**, **email**, **subject**, **message**, **audience** (server-admin | streamer | viewer).
- Optional: **server ID**, **streamer / account ref**, **priority** (low | normal | high).
- Submissions are sent to **`POST /api/contact`**, which calls **`ghlSyncSupportIntake`** when GHL env vars are set.

### Email

- Users may email the audience address directly; operations should **forward or BCC** into GHL or use native GHL inbox sync so tickets match the same tagging model (manual tag application if automation is not available).

### Priority

| Priority | Use when |
|----------|----------|
| **low**  | General questions, feature ideas |
| **normal** | Default |
| **high** | Production down, cannot connect RCON, payment failures, widespread stream breakage |

## GoHighLevel mapping

### Object model

- **Contact + tags + note** (same pattern as early-access and signup sync). No separate Opportunity API is required for MVP; use **GHL workflows** on tags to move cards or notify owners.

### Standard tags (web intake)

Applied by [`lib/ghl-support.ts`](../lib/ghl-support.ts):

| Tag | Meaning |
|-----|---------|
| `rustmaxx` | Product |
| `support` | Support ticket |
| `server-admin` \| `streamer` \| `viewer` | Audience |
| `channel-web` \| `channel-email` | Intake channel (form uses `web`) |
| `priority-low` \| `priority-normal` \| `priority-high` | Priority |

### Note contents

The GHL **note** includes subject, audience, channel, priority, source (`contact-form`), optional server/streamer IDs, and the full message body. Use GHL’s contact timeline as the system of record for text; **avoid logging full message bodies** in app logs (see observability).

### Pipeline / stage strategy

- **Recommended:** create a **Support** pipeline (or use an existing one) with stages such as *New → Triaged → Waiting on customer → Resolved*.
- **Automation:** trigger on tag `support` + audience tags to assign **opportunity owner** or **round-robin** team in GHL.
- **Email-sourced tickets:** when email is the channel, either tag manually `channel-email` or use GHL automation from inbox rules.

## Internal vs external communication

Aligned with the split described in [`TIKFINITY_WEBHOOK_SOLUTION.md`](./TIKFINITY_WEBHOOK_SOLUTION.md): **webhooks and public URLs are external edges**; **RCON, DB, and plugins stay inside** the trusted network.

| Path | External | Internal | Notes |
|------|----------|----------|--------|
| User email → mailbox / `/contact` | ✓ | | Public |
| `/contact` → `POST /api/contact` | ✓ | | Next.js route |
| API → GHL REST API | ✓ | | Outbound only; token server-side |
| API → Postgres | | ✓ | Optional future: audit without storing full PII |
| TikFinity / TikTok → webhooks | ✓ | | Same external boundary as other webhooks |
| App → RCON → game server | | ✓ | Never expose RCON to browser |
| Support staff ↔ customer email | ✓ | | Use official `@rustmaxx.com` addresses only for official comms |

**Do not** put RCON passwords, session secrets, or raw GHL tokens in customer-facing email or client-side JS.

## Observability & privacy

- **Logs:** log **success/failure**, **audience**, optional **contact id**, and **error classification** — not full message body (see [`app/api/contact/route.ts`](../app/api/contact/route.ts)).
- **Retention:** GHL holds message content per your GHL subscription; align with your privacy policy.

## Code touchpoints (integration map)

| Piece | Location |
|-------|----------|
| Contact UI | [`app/contact/page.tsx`](../app/contact/page.tsx) |
| Support ingest API | [`app/api/contact/route.ts`](../app/api/contact/route.ts) |
| GHL support sync | [`lib/ghl-support.ts`](../lib/ghl-support.ts) |
| Shared GHL contact+note helper | [`lib/ghl.ts`](../lib/ghl.ts) (`ghlCreateContactWithOptionalNote`) |
| Early-access / signup patterns | [`lib/ghl.ts`](../lib/ghl.ts), [`app/api/early-access/route.ts`](../app/api/early-access/route.ts) |

## Validation checklist

- [ ] Submit test requests per **audience**; confirm tags and note in GHL.
- [ ] With GHL env vars **unset**, form still succeeds with **warning** and copy points users to email.
- [ ] Force invalid token / timeout; user sees friendly error and mailto options remain.
