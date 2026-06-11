import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { NewClientView } from './NewClientView';

/**
 * Add / returning client — the search-first on-ramp. Type a name; if they
 * already exist you jump straight to their record, otherwise you create a
 * fresh one. This is the door the cold funnel never had.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Add client' };

export default async function NewClientPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect('/signin?callbackUrl=/clients/new');
  const role = user.role ?? 'partner';

  return (
    <div className="app-shell acc-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <NewClientView />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
