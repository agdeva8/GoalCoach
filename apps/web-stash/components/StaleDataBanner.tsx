// Informational banner for results that may no longer be current.
//
// Deliberately separate from CardErrorBanner: that one is actionable
// (retryable/fatal + onRetry), this one only reports staleness, so it takes no
// callback and stays a server component. Staleness is not an error state, so it
// uses the slate tone rather than --error.
export function StaleDataBanner({ minutesAgo }: { minutesAgo: number }) {
  return (
    <aside
      role="alert"
      data-banner="card-stale"
      style={{
        border: '1px solid var(--slate, #6B6B68)',
        borderRadius: '0',
        padding: '0.75rem 1rem',
        background: 'var(--paper, #FAF8F4)',
        color: 'var(--ink, #1A1A1A)',
        fontFamily: 'Inter, system-ui',
        fontSize: '0.875rem',
      }}
    >
      <p style={{ margin: 0 }}>
        Some data may be stale. Last fetched {minutesAgo}m ago.
      </p>
    </aside>
  );
}
