'use client';
import { useState } from 'react';

export function MagicLinkModal({
  open,
  onSubmit,
  onClose,
}: {
  open: boolean;
  onSubmit: (email: string) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Sign in with magic link"
      data-component="magic-link-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(email);
        }}
        style={{
          background: 'var(--paper, #FAF8F4)',
          color: 'var(--ink, #1A1A1A)',
          padding: '1.5rem',
          border: '1px solid var(--slate, #6B6B68)',
          borderRadius: '0',
          fontFamily: 'Inter, system-ui',
          minWidth: '320px',
        }}
      >
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', margin: '0 0 1rem 0', fontSize: '1.25rem' }}>
          Sign in
        </h2>
        <label
          htmlFor="magic-link-email"
          style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem' }}
        >
          Email
        </label>
        <input
          id="magic-link-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            display: 'block',
            width: '100%',
            padding: '0.5rem',
            border: '1px solid var(--slate, #6B6B68)',
            borderRadius: '4px',
            fontFamily: 'Inter, system-ui',
            marginBottom: '1rem',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid var(--slate, #6B6B68)',
              borderRadius: '4px',
              background: 'transparent',
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              fontFamily: 'Inter, system-ui',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            style={{
              border: '1px solid var(--ink, #1A1A1A)',
              borderRadius: '4px',
              background: 'var(--ink, #1A1A1A)',
              color: 'var(--paper, #FAF8F4)',
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              fontFamily: 'Inter, system-ui',
            }}
          >
            Send link
          </button>
        </div>
      </form>
    </div>
  );
}
