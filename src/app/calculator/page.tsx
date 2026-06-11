import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { getCatalog } from '@/lib/catalog';
import { CalculatorClient } from './CalculatorClient';

/**
 * Calculator route. Server component: gates on the session, loads the
 * catalog once, hands it to the interactive client component. proxy.ts
 * already blocks anonymous access; the redirect here is belt-and-braces.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Calculator' };

export default async function CalculatorPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/calculator');

  const role = user.role ?? 'partner';
  const catalog = await getCatalog();

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Calculator
            </div>
            <h1
              style={{
                fontSize: 'clamp(1.6rem, 3vw, 2.3rem)',
                fontFamily: 'var(--font-playfair), serif',
                fontWeight: 400,
                letterSpacing: '-0.01em',
                marginBottom: '0.5rem',
              }}
            >
              Build a <em style={{ color: 'var(--accent)' }}>quote</em>.
            </h1>
            <p style={{ color: 'var(--text-mid)', marginBottom: '1.75rem', maxWidth: '54ch' }}>
              Pick a package, layer add-ons, watch the price settle. Every number
              traces back to the worksheet — change the worksheet, change this.
              Save it when it&apos;s right.
            </p>

            <CalculatorClient catalog={catalog} role={role} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
