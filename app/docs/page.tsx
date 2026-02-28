import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { TerminalCard } from "@/components/marketing/TerminalCard";

export const metadata = {
  title: "Docs | RustMaxx",
  description: "Getting started with RustMaxx: add server, RCON, optional plugin, permissions.",
  openGraph: { title: "Docs | RustMaxx", description: "Getting started and security model." },
};

const ENV_EXAMPLE = `DATABASE_URL=postgresql://user:pass@host:5432/rustmaxx
SESSION_SECRET=your-long-random-secret
ADMIN_PASSWORD=your-admin-login-password
NEXTAUTH_URL=https://your-domain.com`;

const PLUGIN_EXAMPLE = `{
  "api_url": "https://your-rustmaxx-instance.com",
  "server_id": "your-server-id",
  "features": ["map", "events"]
}`;

export default function DocsPage() {
  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold text-zinc-100">Documentation</h1>
          <p className="mt-2 text-zinc-400">
            Get up and running. Replace placeholders with your actual values.
          </p>

          <section className="mt-12">
            <h2 className="text-xl font-semibold text-zinc-100">Getting started</h2>
            <ol className="mt-4 list-inside list-decimal space-y-6 text-zinc-300">
              <li>
                <strong className="text-zinc-100">Add your server</strong> — In the dashboard, add
                a server with a name, RCON host, port, and password. Use the host/port your Rust
                server or host provides for WebRCON.
              </li>
              <li>
                <strong className="text-zinc-100">Connect RCON</strong> — Click Connect. RustMaxx
                will establish an outbound WebSocket to your server. No inbound ports on your side.
              </li>
              <li>
                <strong className="text-zinc-100">Install optional plugin</strong> — For live map
                and some intel features, install our server-side plugin (Oxide/uMod). Upload to your
                server and configure as below.
              </li>
              <li>
                <strong className="text-zinc-100">Set permissions</strong> — Use the dashboard to
                assign staff roles and limit who can run which commands. Audit logs track all
                actions.
              </li>
            </ol>
          </section>

          <section className="mt-12">
            <h2 className="text-xl font-semibold text-zinc-100">Environment variables</h2>
            <p className="mt-2 text-sm text-zinc-400">
              For self-hosted RustMaxx, set these (example placeholders):
            </p>
            <TerminalCard title=".env.example" className="mt-4">
              <pre className="whitespace-pre-wrap text-zinc-400">{ENV_EXAMPLE}</pre>
            </TerminalCard>
          </section>

          <section className="mt-12">
            <h2 className="text-xl font-semibold text-zinc-100">Plugin config (placeholder)</h2>
            <p className="mt-2 text-sm text-zinc-400">
              If you use the optional map/intel plugin, configure it on the server. Example
              structure (replace with real plugin config):
            </p>
            <TerminalCard title="config/rustmaxx.json" className="mt-4">
              <pre className="whitespace-pre-wrap text-zinc-400">{PLUGIN_EXAMPLE}</pre>
            </TerminalCard>
          </section>

          <section className="mt-12">
            <h2 className="text-xl font-semibold text-zinc-100">Security model</h2>
            <p className="mt-2 text-sm text-zinc-400">
              We keep security simple and transparent.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-zinc-300">
              <li>
                <strong className="text-zinc-100">Stored credentials</strong> — RCON credentials
                are stored encrypted. We never log or expose your RCON password in plain text.
              </li>
              <li>
                <strong className="text-zinc-100">Signed requests</strong> — Where the plugin
                talks to RustMaxx, we use HMAC or signed tokens so only your server can authenticate.
              </li>
              <li>
                <strong className="text-zinc-100">Audit logs</strong> — Every command run through
                the dashboard is logged (who, when, what). You can export and review.
              </li>
              <li>
                <strong className="text-zinc-100">Outbound-only</strong> — RustMaxx initiates
                connections to your game server. You don&apos;t need to open ports to the internet.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </MarketingLayout>
  );
}
