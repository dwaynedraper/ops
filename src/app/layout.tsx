import type { Metadata } from 'next';
import { Playfair_Display, Montserrat } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { Providers } from './providers';

const PLAUSIBLE_SCRIPT = process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT;

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
            __html: `(function(){try{var p=localStorage.getItem('ss_ops_theme');var sys=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var r=(p==='light'||p==='dark')?p:sys;var root=document.documentElement;root.classList.remove('dark','light');root.classList.add(r);}catch(e){}})();`,
          }}
        />
        {/* Plausible — gated on NEXT_PUBLIC_PLAUSIBLE_SCRIPT. Matches the
            pattern used across the four sister sites (landing/photos/
            media/studio). Ops sets robots:noindex above so search
            engines never see the page anyway; analytics here are for
            measuring rep activity, not SEO. */}
        {PLAUSIBLE_SCRIPT && <script async src={PLAUSIBLE_SCRIPT} />}
        {PLAUSIBLE_SCRIPT && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()`,
            }}
          />
        )}
      </head>
      <body className="min-h-screen font-sans">
        <Providers>{children}</Providers>
        <SpeedInsights />
      </body>
    </html>
  );
}
