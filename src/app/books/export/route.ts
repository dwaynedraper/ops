/**
 * Wave CSV export route — GET /books/export?month=YYYY-MM&type=income|expenses|mileage.
 *
 * Super-admin only (the whole-business books). Builds the month's rows,
 * shapes them to Wave's Date/Description/Amount, and streams a CSV download.
 * No storage — generated fresh per request, like the quote PDF route.
 */

import { auth } from '@/auth';
import {
  resolveMonth,
  loadBooks,
  incomeToWave,
  expensesToWave,
  mileageToWave,
} from '@/lib/books';
import { toWaveCsv } from '@/lib/wave-export';

type ExportType = 'income' | 'expenses' | 'mileage';

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (session?.user?.role !== 'super_admin') {
    return new Response('Not found.', { status: 404 });
  }

  const url = new URL(req.url);
  const type = (url.searchParams.get('type') ?? 'income') as ExportType;
  const month = resolveMonth(url.searchParams.get('month'));
  const books = await loadBooks(month);

  const rows =
    type === 'expenses'
      ? expensesToWave(books.expenses)
      : type === 'mileage'
        ? mileageToWave(books.mileage)
        : incomeToWave(books.income);

  const csv = toWaveCsv(rows);
  const filename = `sharp-sighted-${type}-${month.month}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
