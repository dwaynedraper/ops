import type { Metadata } from 'next';
import { Playfair_Display, Montserrat } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { Providers } from './providers';

const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500'],
  style: ['normal', 'italic'],
});

const montserrat = Montserrat({
  variable: '--font-montserrat',
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const SITE_URL = 'https://ops.sharpsighted.studio';

export const metadata: Metadata = {
  title: {
    template: '%s — Sharp Sighted Ops',
    default: 'Sharp Sighted Ops',
  },
  description:
    'The internal operating tool for Sharp Sighted Studio. Pricing, quotes, and the daily working surface for Dean and the partner network.',
  metadataBase: new URL(SITE_URL),
  // Internal app: keep search engines out. There is nothing here for them.
  robots: { index: false, follow: false, nocache: true },
  alternates: { canonical: SITE_URL },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${montserrat.variable} dark`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/* No-FOUC theme script — runs before paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('ss_ops_theme');var root=document.documentElement;root.classList.remove('dark','light');root.classList.add(t==='light'?'light':'dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen font-sans">
        <Providers>{children}</Providers>
        <SpeedInsights />
      </body>
    </html>
  );
}
