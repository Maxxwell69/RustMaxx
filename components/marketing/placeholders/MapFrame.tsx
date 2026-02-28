export function MapFrame({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="640" height="360" rx="8" fill="#111215" stroke="#1e2124" strokeWidth="1" />
      {/* Contour / grid feel */}
      <path
        d="M0 180 Q160 120 320 180 T640 180"
        stroke="#1e2124"
        strokeWidth="0.5"
        fill="none"
      />
      <path
        d="M0 200 Q160 260 320 200 T640 200"
        stroke="#1e2124"
        strokeWidth="0.5"
        fill="none"
      />
      <line x1="320" y1="0" x2="320" y2="360" stroke="#1e2124" strokeWidth="0.5" />
      <line x1="0" y1="180" x2="640" y2="180" stroke="#1e2124" strokeWidth="0.5" />
      {/* Placeholder "map" blob */}
      <ellipse cx="320" cy="180" rx="140" ry="100" fill="#0c0d0e" stroke="#1e2124" strokeWidth="1" />
      <circle cx="280" cy="160" r="6" fill="#22c55e" fillOpacity="0.6" />
      <circle cx="360" cy="200" r="6" fill="#f59e0b" fillOpacity="0.6" />
      <circle cx="320" cy="140" r="4" fill="#06b6d4" fillOpacity="0.5" />
      <rect x="16" y="12" width="140" height="8" rx="2" fill="#1e2124" />
    </svg>
  );
}
