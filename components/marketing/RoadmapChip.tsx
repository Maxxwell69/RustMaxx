type Variant = "available" | "planned";

export function RoadmapChip({ variant }: { variant: Variant }) {
  const isAvailable = variant === "available";
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
        isAvailable
          ? "bg-rust-green/15 text-rust-green"
          : "bg-rust-amber/15 text-rust-amber"
      }`}
    >
      {isAvailable ? "Available now" : "Roadmap"}
    </span>
  );
}
