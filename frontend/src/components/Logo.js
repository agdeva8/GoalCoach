export default function Logo({ className = "w-6 h-6" }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      {/* compass needle pointing up — the guide */}
      <path d="M16 5 L19.5 16 L16 20 L12.5 16 Z" fill="currentColor" />
      <path d="M16 27 L12.5 16 L16 20 L19.5 16 Z" fill="currentColor" opacity="0.45" />
      <circle cx="16" cy="16" r="2.4" fill="var(--bg-primary)" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
