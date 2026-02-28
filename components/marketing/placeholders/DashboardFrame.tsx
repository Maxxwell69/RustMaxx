export function DashboardFrame({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="640" height="360" rx="8" fill="#111215" stroke="#1e2124" strokeWidth="1" />
      <rect x="16" y="12" width="120" height="8" rx="2" fill="#1e2124" />
      <rect x="16" y="28" width="200" height="120" rx="4" fill="#0c0d0e" stroke="#1e2124" strokeWidth="1" />
      <rect x="16" y="156" width="200" height="80" rx="4" fill="#0c0d0e" stroke="#1e2124" strokeWidth="1" />
      <rect x="228" y="28" width="396" height="208" rx="4" fill="#0c0d0e" stroke="#1e2124" strokeWidth="1" />
      <line x1="240" y1="44" x2="608" y2="44" stroke="#1e2124" strokeWidth="1" />
      <rect x="240" y="56" width="80" height="6" rx="1" fill="#22c55e" fillOpacity="0.3" />
      <rect x="330" y="56" width="120" height="6" rx="1" fill="#6b7280" fillOpacity="0.5" />
      <rect x="460" y="56" width="140" height="6" rx="1" fill="#6b7280" fillOpacity="0.5" />
      <rect x="240" y="72" width="360" height="1" fill="#1e2124" />
      <rect x="240" y="80" width="60" height="6" rx="1" fill="#06b6d4" fillOpacity="0.4" />
      <rect x="310" y="80" width="100" height="6" rx="1" fill="#6b7280" fillOpacity="0.5" />
      <rect x="420" y="80" width="180" height="6" rx="1" fill="#6b7280" fillOpacity="0.5" />
      <rect x="16" y="248" width="608" height="48" rx="4" fill="#0c0d0e" stroke="#1e2124" strokeWidth="1" />
      <rect x="24" y="260" width="200" height="8" rx="2" fill="#1e2124" />
      <rect x="24" y="276" width="120" height="6" rx="1" fill="#6b7280" fillOpacity="0.5" />
    </svg>
  );
}
