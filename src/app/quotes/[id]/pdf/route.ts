/**
 * Quote PDF route — GET /quotes/[id]/pdf.
 *
 * The manual PDF trigger: the quote detail page links here, the document
 * is rendered fresh on each request (no storage), and streamed back as a
 * download. Access is owner-checked inside loadQuoteForUser; proxy.ts
 * already blocks anonymous requests.
 */

import { renderToBuffer } from '@react-pdf/renderer';
import { loadQuoteForUser } from '@/lib/quotes';
import { QuotePdf } from '@/components/QuotePdf';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const loaded = await loadQuoteForUser(id);
  if (!loaded) {
    return new Response('Quote not found.', { status: 404 });
  }

  // QuotePdf returns the <Document> element directly — what renderToBuffer wants.
  const buffer = await renderToBuffer(QuotePdf({ quote: loaded.quote, lines: loaded.lines }));

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Sharp-Sighted-Quote-${loaded.quote.quoteNumber}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
