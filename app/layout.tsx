import type { Metadata } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { Provider } from '@/components/provider';
import { appName } from '@/lib/shared';
import './global.css';

// Real AgentKit brand font stack (mirrors ak-web/app/root-document.tsx):
// Geist for body/UI, Geist Mono for code/labels, Instrument Serif for EN
// display headings. Instrument Serif is latin-only and is applied to EN
// headings only — Vietnamese headings swap to Geist via a locale rule in
// global.css.
//
// NOTE (bilingual VI): Google Fonts' Geist exposes only latin / latin-ext /
// cyrillic subsets — no dedicated `vietnamese` subset. latin-ext covers most
// Vietnamese letters; Phase 3 must validate full VI glyph coverage on real
// content and, if latin-ext falls short of the U+1EA0–1EF9 range, switch to the
// self-hosted `geist` npm package (full VI support) instead of next/font/google.
const geistSans = Geist({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-geist-sans',
});

const geistMono = Geist_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-geist-mono',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
});

export const metadata: Metadata = {
  title: {
    default: `${appName} Docs`,
    template: `%s · ${appName} Docs`,
  },
  description: `Official documentation for the ${appName} (ak) CLI.`,
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen font-sans">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
