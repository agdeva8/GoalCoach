export default function Logo({ className = "w-6 h-6" }) {
  // Branded mark for GoalCoach: a target with an arrow striking the
  // bullseye. Communicates the product idea — pick a target, hit it.
  // Kept as a single SVG so it inherits `currentColor` (warm accent).
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      {/* outer ring */}
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.6" opacity="0.25" />
      {/* middle ring */}
      <circle cx="16" cy="16" r="8.5" stroke="currentColor" strokeWidth="1.4" opacity="0.45" />
      {/* bullseye */}
      <circle cx="16" cy="16" r="3.4" fill="currentColor" />
      {/* arrow shaft striking from upper right */}
      <path
        d="M22.5 9.5 L16.5 15.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* fletching at the back of the arrow */}
      <path
        d="M23.8 8.2 L25 9.4 M22 9 L23.4 10.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* a single warm pulse above the target — "this week" */}
      <circle cx="16" cy="2.5" r="1.2" fill="currentColor" opacity="0.85" />
    </svg>
  );
}
