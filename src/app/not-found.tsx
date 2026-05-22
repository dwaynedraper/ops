import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div className="eyebrow">404</div>
        <h1
          style={{
            fontFamily: 'var(--font-playfair), serif',
            fontSize: '2rem',
            fontWeight: 400,
            margin: '0.5rem 0 1rem',
          }}
        >
          <em style={{ color: 'var(--accent)' }}>Nothing</em> on this surface.
        </h1>
        <p style={{ color: 'var(--text-mid)', marginBottom: '1.5rem' }}>
          The page you&apos;re looking for doesn&apos;t exist in ops. Try the
          dashboard, or head back to the public studio.
        </p>
        <Link href="/" className="btn-primary">Dashboard</Link>
      </div>
    </main>
  );
}
