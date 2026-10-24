'use client';

/** Last-resort boundary (root layout failed). Kept dependency-free. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ background: '#0B0B0F', color: '#E5E7EB', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ maxWidth: 480, margin: '15vh auto', padding: 16, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20 }}>The dashboard hit an unexpected error</h1>
          <p style={{ color: '#9CA3AF', fontSize: 14 }}>
            Please try again. If it keeps happening, share the reference with the team.
          </p>
          {error.digest && (
            <p style={{ color: '#9CA3AF', fontFamily: 'monospace', fontSize: 12 }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: '#22D3EE',
              color: '#0B0B0F',
              border: 0,
              borderRadius: 6,
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
