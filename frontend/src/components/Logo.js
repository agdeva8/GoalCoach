export default function Logo({ className = "w-6 h-6" }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path
        d="M16 3.5 L17.7 11.2 L24.5 12.7 L17.7 14.2 L16 21.9 L14.3 14.2 L7.5 12.7 L14.3 11.2 Z"
        fill="currentColor"
      />
      <path
        d="M4.5 27 C 10.5 27, 11.5 20.5, 17.5 20.5 C 22.5 20.5, 23.5 24, 27.5 22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
    </svg>
  );
}
