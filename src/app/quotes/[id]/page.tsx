import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Sidebar } from '@/components/Sidebar';
import { Footer } from '@/components/Footer';
import { fmtMoney } from '@/lib/pricing';
import { loadQuoteForUser } from '@/lib/quotes';

/**
 * Quote detail page — the review-and-approve surface.
 *
 * Read-only: the full quote (client info, line items, total, audit
 * timeline) laid out for one last look before the PDF is generated.
 * The PDF is a deliberate manual trigger — the link to /quotes/[id]/pdf
 * renders the document fresh on click; nothing is generated until then.
 */
export const dynamic = 'force-dynamic';

const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--text-faint)',
  sent: 'var(--warn)',
  accepted: 'var(--good)',
  declined: 'var(--bad)',
  archived: 'var(--text-faint)',
};

const EVENT_LABEL: Record<string, string> = {
  created: 'Quote created',
  updated: 'Quote updated',
  sent: 'Sent to client',
  accepted: 'Accepted',
  declined: 'Declined',
  archived: 'Archived',
  note: 'Note added',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = await loadQuoteForUser(id);
  return { title: loaded ? `Quote No. ${loaded.quote.quoteNumber}` : 'Quote' };
}

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=/quotes/${id}`);

  const loaded = await loadQuoteForUser(id);
  if (!loaded) notFound();

  const { quote, lines, events, viewerRole } = loaded;
  const role = viewerRole;

  return (
    <div className="app-shell">
      <Sidebar role={role} />

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <main className="app-shell-main" style={{ flex: 1 }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <Link
              href={quote.prospectId ? `/prospects/${quote.prospectId}` : '/'}
              className="btn-ghost"
              style={{ alignSelf: 'flex-start', padding: '0.2rem 0' }}
            >
              ← {quote.prospectId ? 'Client page' : 'Dashboard'}
            </Link>

            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '1rem',
                marginTop: '0.75rem',
                marginBottom: '1.5rem',
              }}
            >
              <div>
                <div className="eyebrow" style={{ marginBottom: '0.35rem' }}>
                  Quote
                </div>
                <h1
                  style={{
                    fontFamily: 'var(--font-playfair), serif',
                    fontSize: 'clamp(1.6rem, 3vw, 2.3rem)',
                    fontWeight: 400,
                    letterSpacing: '-0.01em',
                    margin: 0,
                  }}
                >
                  Quote No. <em style={{ color: 'var(--accent)' }}>{quote.quoteNumber}</em>
                </h1>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-faint)', marginTop: '0.3rem' }}>
                  Built {quote.createdAtLabel}
                  {quote.createdByName ? ` by ${quote.createdByName}` : ''}
                </p>
              </div>
              <span
                style={{
                  fontSize: '0.64rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: STATUS_COLOR[quote.status] ?? 'var(--text-faint)',
                  border: `1px solid ${STATUS_COLOR[quote.status] ?? 'var(--text-faint)'}`,
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.22rem 0.55rem',
                  flexShrink: 0,
                }}
              >
                {quote.status}
              </span>
            </div>

            {/* Client info */}
            <div className="surface-tool" style={{ marginBottom: '1.25rem' }}>
              <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
                Prepared for
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                <Field label="Client" value={quote.clientName} />
                <Field label="Project" value={quote.projectName} />
                <Field label="Email" value={quote.clientEmail} />
                <Field label="Phone" value={quote.clientPhone} />
                <Field label="Target date" value={quote.targetDateLabel} />
              </div>
              {quote.clientNotes && (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-mid)', marginTop: '0.85rem' }}>
                  {quote.clientNotes}
                </p>
              )}
            </div>

            {/* Line items */}
            <div className="surface-tool" style={{ marginBottom: '1.25rem' }}>
              <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>
                Line items
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {lines.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '0.85rem',
                      alignItems: 'baseline',
                      paddingBottom: '0.6rem',
                      borderBottom:
                        i < lines.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.86rem', color: 'var(--text)' }}>{l.label}</div>
                      {l.description && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                          {l.description}
                        </div>
                      )}
                      {l.qty > 1 && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {l.qty} ×{' '}
                          {l.unitLabel
                            ? `${fmtMoney(l.unitPrice)}/${l.unitLabel}`
                            : fmtMoney(l.unitPrice)}
                        </div>
                      )}
                    </div>
                    <div className="money" style={{ fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                      {fmtMoney(l.lineTotal)}
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  borderTop: '1px solid var(--border-strong)',
                  marginTop: '0.6rem',
                  paddingTop: '0.75rem',
                }}
              >
                <span
                  style={{
                    fontSize: '0.7rem',
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: 'var(--text-mid)',
                    fontWeight: 600,
                  }}
                >
                  Total
                </span>
                <span
                  className="money"
                  style={{ fontSize: '1.85rem', color: 'var(--accent)', lineHeight: 1 }}
                >
                  {fmtMoney(quote.totalPrice)}
                </span>
              </div>

              {role === 'super_admin' && (
                <div
                  style={{
                    marginTop: '0.6rem',
                    fontSize: '0.72rem',
                    color: 'var(--text-faint)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Cost basis {fmtMoney(quote.totalCost)}</span>
                  <span>Margin {fmtMoney(quote.totalMargin)}</span>
                </div>
              )}
            </div>

            {/* Create PDF */}
            <div className="surface-tool" style={{ marginBottom: '1.25rem' }}>
              <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
                Client PDF
              </div>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-mid)', marginBottom: '0.9rem' }}>
                This is the last look. The PDF is built fresh when you click — a
                clean, client-facing proposal with prices only, no internal numbers.
              </p>
              <a
                href={`/quotes/${quote.id}/pdf`}
                className="btn-primary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Create the PDF
              </a>
            </div>

            {/* Timeline */}
            {events.length > 0 && (
              <div className="surface-tool" style={{ marginBottom: '1.25rem' }}>
                <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
                  History
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {events.map((e, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.8rem',
                      }}
                    >
                      <span style={{ color: 'var(--text)' }}>
                        {EVENT_LABEL[e.kind] ?? e.kind}
                      </span>
                      <span style={{ color: 'var(--text-faint)' }}>{e.createdAtLabel}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textAlign: 'center' }}>
              Stay Sharp. Stay Seen. Stay Human.
            </p>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div
        style={{
          fontSize: '0.66rem',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
          fontWeight: 600,
          marginBottom: '0.2rem',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '0.86rem', color: value ? 'var(--text)' : 'var(--text-faint)' }}>
        {value || '—'}
      </div>
    </div>
  );
}
