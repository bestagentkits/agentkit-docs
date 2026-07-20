import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Provider } from '@/components/provider';
import { appName } from '@/lib/shared';
import './global.css';

// AgentKit brand font stack: Geist for everything (body, UI, and headings in
// both EN and VI), Geist Mono for code/labels. All-sans headings keep the two
// locales visually identical (a serif would only work for EN — Vietnamese
// diacritics force sans — so we use sans for both).
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
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen font-sans">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
