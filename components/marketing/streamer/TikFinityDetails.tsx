export function TikFinityDetails() {
  return (
    <section
      className="border-b border-rust-border bg-rust-surface/50 px-4 py-12 sm:px-6 sm:py-16"
      aria-labelledby="tikfinity-details-heading"
    >
      <div className="mx-auto max-w-3xl">
        <h2
          id="tikfinity-details-heading"
          className="text-center text-2xl font-bold text-zinc-100 sm:text-3xl"
        >
          TikTok Live + TikFinity
        </h2>
        <p className="mt-4 text-center text-sm text-zinc-400">
          RustMaxx is built around{" "}
          <strong className="text-zinc-300">TikTok Live</strong> first.{" "}
          <a
            href="https://tikfinity.zerody.one"
            className="text-rust-cyan underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            TikFinity
          </a>{" "}
          is the bridge: it turns gifts, goals, chat events, and custom triggers into HTTPS webhooks that hit RustMaxx, which then runs your server rules (RustChaos actions, MaxxInvaders spawns, crew checks, and more).
        </p>

        <div className="mt-10 space-y-8 text-sm text-zinc-400">
          <div>
            <h3 className="text-base font-semibold text-zinc-200">What you configure</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong className="text-zinc-300">RustMaxx account + Profile</strong> — Link your streamer subscription,
                set your <strong className="text-zinc-300">Steam64</strong> so in-game actions and patrol anchors resolve
                to the right player.
              </li>
              <li>
                <strong className="text-zinc-300">Admin → Streamer interactions</strong> — Copy your per-server webhook
                URLs, map <strong className="text-zinc-300">TikFinity connections</strong> (event names → server actions),
                and grab spawn templates (for example Roaming NPC / <code className="text-emerald-600/90">npcmaxx</code>).
              </li>
              <li>
                <strong className="text-zinc-300">Server dashboard</strong> — Allow TikFinity for that server, tune{" "}
                <strong className="text-zinc-300">Streamer interactions</strong> allowed actions, and optionally set a{" "}
                <strong className="text-zinc-300">TikFinity patrol anchor</strong> (Steam id) so spawns leash to you when
                the webhook does not pass <code className="text-emerald-600/90">anchorSteam</code>.
              </li>
              <li>
                <strong className="text-zinc-300">TikFinity (tikfinity.zerody.one)</strong> — Create{" "}
                <strong className="text-zinc-300">Actions</strong> with <strong className="text-zinc-300">Trigger WebHook</strong>{" "}
                pointing at the full URL RustMaxx shows you (must be public <strong className="text-zinc-300">HTTPS</strong>, not
                localhost). Use <strong className="text-zinc-300">Connections</strong> so gift names or custom event names
                match the rules you defined in RustMaxx.
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-base font-semibold text-zinc-200">TikFinity URL placeholders (viewer identity)</h3>
            <p className="mt-2">
              In the webhook URL or JSON body, TikFinity can substitute the triggering viewer&apos;s TikTok fields — for
              example so MaxxInvaders shows the correct nickname on a bot:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>
                <code className="text-emerald-600/90">%nickname%</code> — display name (common for NPC labels)
              </li>
              <li>
                <code className="text-emerald-600/90">%username%</code> — @handle
              </li>
              <li>
                <code className="text-emerald-600/90">%userId%</code> — numeric id (use for crew / unique viewer tracking
                when the payload must include <code className="text-emerald-600/90">userId</code> or{" "}
                <code className="text-emerald-600/90">uniqueId</code>)
              </li>
            </ul>
            <p className="mt-3 text-xs text-zinc-500">
              If a name shows up literally as <code className="text-emerald-600/90">%nickname%</code>, TikFinity did not
              expand the variable — prefer POST JSON with <code className="text-emerald-600/90">viewerName</code> set from
              TikFinity&apos;s variable picker, or fix the action&apos;s query string substitution.
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold text-zinc-200">Production URL must match</h3>
            <p className="mt-2">
              The host in TikFinity must match your live site exactly (including <strong className="text-zinc-300">www</strong>{" "}
              vs apex). RustMaxx uses your configured public base URL for webhook links; mismatched origins break OAuth-style
              flows and webhooks alike.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
