import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Provider } from '@/components/provider';
import { i18n } from '@/lib/i18n';
import { appName } from '@/lib/shared';
import { jsonLdScript } from '@/lib/json-ld.mjs';
import '../global.css';

const SITE_URL = 'https://docs.agentkit.best';

// Sitewide, not per-page: same facts on every route (name, URL, logo), so
// rendering it once in the shared layout avoids duplicating identical
// structured data across ~1,600 pages.
const siteJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: `${appName} Docs`,
    url: SITE_URL,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: appName,
    url: SITE_URL,
    logo: `${SITE_URL}/logo-icon.svg`,
  },
];

// AgentKit brand font stack: Geist for everything (body, UI, and headings in
// both EN and VI), Geist Mono for code/labels. All-sans headings keep the two
// locales visually identical (a serif would only work for EN — Vietnamese
// diacritics force sans — so we use sans for both).
//
// Self-hosted via the `geist` package (next/font/local) rather than
// next/font/google: Google Fonts' Geist exposes only latin / latin-ext, which
// omit the Latin Extended Additional block (U+1EA0–1EF9) that carries most
// Vietnamese tone-marked letters (ệ, ộ, ợ, …). The bundled woff2 covers the full
// Vietnamese letterset, so VI renders in Geist instead of a fallback font.

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${appName} Docs`,
    template: `%s · ${appName} Docs`,
  },
  description: `Official documentation for the ${appName} (ak) CLI.`,
};

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export default async function Layout({
  params,
  children,
}: LayoutProps<'/[lang]'>) {
  const { lang } = await params;

  return (
    <html
      lang={lang}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen font-sans">
        {siteJsonLd.map((entry) => (
          <script
            key={entry['@type']}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: jsonLdScript(entry) }}
          />
        ))}
        <Provider locale={lang}>{children}</Provider>
      </body>
    </html>
  );
}
