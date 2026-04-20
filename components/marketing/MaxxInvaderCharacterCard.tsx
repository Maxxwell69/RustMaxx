import Image from "next/image";

import type { MaxxInvaderCharacter } from "@/lib/maxxinvaders-characters";

/** Marketing portrait export (e.g. Lumberjack hero) — width × height px, aspect ≈ 2:3 */
export const MAXXINVADER_PROFILE_IMAGE_WIDTH = 504;
export const MAXXINVADER_PROFILE_IMAGE_HEIGHT = 750;

type Props = {
  character: MaxxInvaderCharacter;
};

export function MaxxInvaderCharacterCard({ character }: Props) {
  const { displayName, chatCommand, loadout, role, imageSrc, tier } = character;

  return (
    <article className="flex w-full max-w-[504px] flex-col overflow-hidden rounded-xl border border-rust-border bg-rust-surface/90 shadow-sm transition-all hover:border-rust-cyan/25 hover:shadow-rust-glow-subtle">
      <div
        className="relative w-full bg-gradient-to-br from-zinc-800/90 to-zinc-950 border-b border-rust-border"
        style={{
          aspectRatio: `${MAXXINVADER_PROFILE_IMAGE_WIDTH} / ${MAXXINVADER_PROFILE_IMAGE_HEIGHT}`,
        }}
      >
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={displayName}
            fill
            className="object-contain object-center bg-zinc-950"
            sizes="(max-width: 640px) 100vw, (max-width: 1152px) 45vw, 504px"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="rounded-full border border-zinc-600 bg-zinc-900/80 px-4 py-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Image slot
            </span>
            <p className="text-sm text-zinc-500">
              Add <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs text-zinc-400">public/maxxinvaders/</code>
              + set <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs text-zinc-400">imageSrc</code>
            </p>
          </div>
        )}
        <span
          className={`absolute left-3 top-3 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
            tier === "main"
              ? "bg-rust-cyan/90 text-rust-panel"
              : "bg-amber-500/90 text-zinc-950"
          }`}
        >
          {tier === "main" ? "Main" : "Special event"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">{displayName}</h3>
          <p className="mt-1.5 font-mono text-sm font-medium text-rust-cyan">{chatCommand}</p>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Loadout</h4>
          <ul className="mt-2 space-y-1.5">
            {loadout.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rust-cyan" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-rust-border pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">What they do</h4>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{role}</p>
        </div>
      </div>
    </article>
  );
}
