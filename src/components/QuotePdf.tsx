/**
 * Quote PDF document — the client-facing proposal.
 *
 * Built with @react-pdf/renderer (D-013-era stack choice: Vercel-friendly,
 * no Puppeteer). Server-only — imported by the /quotes/[id]/pdf route,
 * never by a client component. Partner-facing: prices only, never costs
 * or margins.
 *
 * The brand faces are registered from `src/fonts` (.ttf files committed
 * to the repo): Playfair Display for display/serif, Montserrat for body.
 * The /quotes/[id]/pdf route is in `outputFileTracingIncludes` so the
 * font files ship with the serverless bundle.
 */

import path from 'node:path';
import { Document, Page, View, Text, StyleSheet, Font } from '@react-pdf/renderer';
import { fmtMoney } from '@/lib/pricing';
import type { QuoteRecord, QuoteLineRecord } from '@/lib/quotes';

// ─── Brand fonts ───────────────────────────────────────────────────────
// Registered once at module load. `process.cwd()` is the project root
// when the PDF route runs; the .ttf files live in src/fonts.
const fontPath = (file: string): string =>
  path.join(process.cwd(), 'src', 'fonts', file);

Font.register({
  family: 'Montserrat',
  fonts: [
    { src: fontPath('Montserrat_400Regular.ttf'), fontWeight: 400 },
    { src: fontPath('Montserrat_700Bold.ttf'), fontWeight: 700 },
  ],
});
Font.register({
  family: 'Playfair Display',
  fonts: [
    { src: fontPath('PlayfairDisplay_400Regular.ttf'), fontWeight: 400 },
    {
      src: fontPath('PlayfairDisplay_400Regular_Italic.ttf'),
      fontWeight: 400,
      fontStyle: 'italic',
    },
  ],
});

// Playfair Display is a high-contrast face — no hyphenation mid-word.
Font.registerHyphenationCallback((word) => [word]);

const SANS = 'Montserrat';
const SERIF = 'Playfair Display';

const COLOR = {
  ink: '#1a1917',
  mid: '#57534e',
  faint: '#a8a29e',
  cyan: '#0ea5e9',
  rust: '#a0462a',
  rule: '#e7e5e4',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 76,
    paddingHorizontal: 54,
    fontFamily: SANS,
    fontSize: 10,
    color: COLOR.ink,
    lineHeight: 1.5,
  },
  eyebrow: { fontFamily: SANS, fontWeight: 700, fontSize: 8, letterSpacing: 2, color: COLOR.cyan },
  title: { fontFamily: SERIF, fontStyle: 'italic', fontSize: 30, marginTop: 6 },
  rule: { borderBottomWidth: 1, borderBottomColor: COLOR.rule, marginTop: 18, marginBottom: 18 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metaBlock: { maxWidth: '58%' },
  label: { fontFamily: SANS, fontWeight: 700, fontSize: 7.5, letterSpacing: 1.5, color: COLOR.faint, marginBottom: 3 },
  value: { fontSize: 11 },
  sub: { fontSize: 9.5, color: COLOR.mid, marginTop: 2 },
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLOR.ink,
    paddingBottom: 5,
    marginTop: 26,
  },
  th: { fontFamily: SANS, fontWeight: 700, fontSize: 7.5, letterSpacing: 1, color: COLOR.mid },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLOR.rule,
    paddingTop: 8,
    paddingBottom: 8,
  },
  cellDesc: { flex: 1, paddingRight: 12 },
  cellAmt: { width: 92, textAlign: 'right' },
  lineLabel: { fontSize: 10.5 },
  lineDetail: { fontSize: 8.5, color: COLOR.mid, marginTop: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'baseline', marginTop: 18 },
  totalLabel: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 9,
    letterSpacing: 1.5,
    color: COLOR.mid,
    marginRight: 14,
  },
  totalValue: { fontFamily: SERIF, fontStyle: 'italic', fontSize: 24, color: COLOR.rust },
  notes: { marginTop: 22 },
  notesBody: { fontSize: 9.5, color: COLOR.mid },
  footer: {
    position: 'absolute',
    bottom: 38,
    left: 54,
    right: 54,
    borderTopWidth: 1,
    borderTopColor: COLOR.rule,
    paddingTop: 10,
  },
  tagline: { fontFamily: SERIF, fontStyle: 'italic', fontSize: 10, color: COLOR.cyan, textAlign: 'center' },
  contact: { fontSize: 7.5, color: COLOR.faint, textAlign: 'center', marginTop: 4 },
});

export function QuotePdf({
  quote,
  lines,
}: {
  quote: QuoteRecord;
  lines: QuoteLineRecord[];
}) {
  return (
    <Document title={`Sharp Sighted Quote ${quote.quoteNumber}`} author="Sharp Sighted Studio">
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.eyebrow}>SHARP SIGHTED  ·  QUOTE</Text>
        <Text style={styles.title}>Quote No. {quote.quoteNumber}</Text>

        <View style={styles.rule} />

        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.label}>PREPARED FOR</Text>
            <Text style={styles.value}>{quote.clientName || 'Client'}</Text>
            {quote.projectName ? <Text style={styles.sub}>{quote.projectName}</Text> : null}
          </View>
          <View>
            <Text style={styles.label}>DATE</Text>
            <Text style={styles.value}>{quote.createdAtLabel}</Text>
            {quote.targetDateLabel ? (
              <Text style={[styles.label, { marginTop: 8 }]}>TARGET DATE</Text>
            ) : null}
            {quote.targetDateLabel ? (
              <Text style={styles.value}>{quote.targetDateLabel}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.tableHead}>
          <Text style={[styles.th, styles.cellDesc]}>DESCRIPTION</Text>
          <Text style={[styles.th, styles.cellAmt]}>AMOUNT</Text>
        </View>

        {lines.map((l, i) => (
          <View style={styles.row} key={i} wrap={false}>
            <View style={styles.cellDesc}>
              <Text style={styles.lineLabel}>{l.label}</Text>
              {l.description ? <Text style={styles.lineDetail}>{l.description}</Text> : null}
              {l.qty > 1 ? (
                <Text style={styles.lineDetail}>
                  {l.qty}
                  {l.unitLabel
                    ? ` × ${fmtMoney(l.unitPrice)} / ${l.unitLabel}`
                    : ` × ${fmtMoney(l.unitPrice)}`}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.lineLabel, styles.cellAmt]}>{fmtMoney(l.lineTotal)}</Text>
          </View>
        ))}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>{fmtMoney(quote.totalPrice)}</Text>
        </View>

        {quote.clientNotes ? (
          <View style={styles.notes}>
            <Text style={styles.label}>NOTES</Text>
            <Text style={styles.notesBody}>{quote.clientNotes}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text style={styles.tagline}>Stay Sharp. Stay Seen. Stay Human.</Text>
          <Text style={styles.contact}>
            Sharp Sighted Studio   ·   dean@sharpsightedstudio.com   ·   (214) 233-5338
          </Text>
        </View>
      </Page>
    </Document>
  );
}
