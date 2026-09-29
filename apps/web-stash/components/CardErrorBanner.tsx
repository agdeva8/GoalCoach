'use client';

export type CardError =
  | { kind: 'retryable'; message: string }
  | { kind: 'fatal'; message: string };

export function CardErrorBanner({
  error,
  onRetry,
}: {
  error: CardError;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      data-error-kind={error.kind}
      style={{
        border: '1px solid var(--error, #B44)',
        borderRadius: '0',
        padding: '0.75rem 1rem',
        background: 'var(--paper, #FAF8F4)',
        color: 'var(--ink, #1A1A1A)',
        fontFamily: 'Inter, system-ui',
        fontSize: '0.875rem',
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'center',
      }}
    >
      <span style={{ flex: 1 }}>{error.message}</span>
      {error.kind === 'retryable' && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            border: '1px solid var(--ink, #1A1A1A)',
            borderRadius: '4px',
            background: 'var(--paper, #FAF8F4)',
            padding: '0.25rem 0.75rem',
            cursor: 'pointer',
            fontFamily: 'Inter, system-ui',
            fontSize: '0.875rem',
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
