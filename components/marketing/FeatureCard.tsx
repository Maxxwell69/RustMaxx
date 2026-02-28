import { RoadmapChip } from "./RoadmapChip";

type FeatureCardProps = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  bullets?: string[];
  available?: boolean;
};

export function FeatureCard({
  title,
  description,
  icon,
  bullets = [],
  available = true,
}: FeatureCardProps) {
  return (
    <div className="rounded-lg border border-rust-border bg-rust-surface p-5 transition-colors hover:border-rust-mute">
      <div className="flex items-start justify-between gap-2">
        <div className="flex gap-3">
          {icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-rust-border bg-rust-panel text-rust-cyan">
              {icon}
            </div>
          )}
          <div>
            <h3 className="font-semibold text-zinc-100">{title}</h3>
            {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
          </div>
        </div>
        <RoadmapChip variant={available ? "available" : "planned"} />
      </div>
      {bullets.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-rust-border pt-4">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-zinc-400">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rust-cyan" />
              {b}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
