/**
 * Logo — Sutra brand mark.
 *
 * Concept: a meditating guru. A seated figure with crossed legs and
 * hands resting on the knees, a "third-eye" dot at the brow, and a
 * silent ring of warmth above the head — life-coach / mentor iconography
 * without sitting on lotus clip-art. Designed in the same warm-accent
 * SVG idiom as the rest of the app: a single 32x32 viewBox, single
 * currentColor stroke + fill, no external deps.
 *
 * The mark is intentionally simple so it reads at the 16px size used
 * in the header and at the 9px size used inside chips.
 */
export default function Logo({ className = "w-6 h-6" }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      data-testid="logo-guru"
    >
      {/* Halo / aura — the bigger semi-circle behind the figure */}
      <circle
        cx="16"
        cy="20"
        r="11.5"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.18"
      />
      {/* Aura inner — concentric warmth */}
      <circle
        cx="16"
        cy="20"
        r="8.5"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.32"
      />

      {/* Head — small circle near the top */}
      <circle cx="16" cy="9.5" r="3.2" fill="currentColor" opacity="0.95" />

      {/* Third-eye dot — accent at the brow */}
      <circle cx="16" cy="9" r="0.85" fill="currentColor" />
      <circle cx="16" cy="9" r="2.4" stroke="currentColor" strokeWidth="0.6" opacity="0.5" />

      {/* Shoulders + torso — a single curve from shoulder to crossed legs */}
      <path
        d="M9.4 17.5 C 11 14.5, 13 13, 16 13 C 19 13, 21 14.5, 22.6 17.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />

      {/* Crossed legs — lotus base. One wide M-shape from knee to knee. */}
      <path
        d="M6 22.6 L 11.5 17.5 L 16 22 L 20.5 17.5 L 26 22.6 C 24 25, 19 26, 16 26 C 13 26, 8 25, 6 22.6 Z"
        fill="currentColor"
        opacity="0.85"
      />

      {/* Hands on knees — two small circles */}
      <circle cx="11.5" cy="22.6" r="1.2" fill="currentColor" />
      <circle cx="20.5" cy="22.6" r="1.2" fill="currentColor" />

      {/* A single warm pulse above the head — "the wisdom" */}
      <circle cx="16" cy="2.5" r="1.05" fill="currentColor" opacity="0.9" />
    </svg>
  );
}
