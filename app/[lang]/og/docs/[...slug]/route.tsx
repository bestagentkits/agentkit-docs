import { getPageImage, source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import { docsOgLayout, getDocsOgTypography } from '@/lib/docs-og-layout.mjs';
import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';
import { appName } from '@/lib/shared';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<'/[lang]/og/docs/[...slug]'>,
) {
  const { lang, slug } = await params;
  const page = source.getPage(slug.slice(0, -1), lang);
  if (!page) notFound();

  const description = page.data.description ?? '';
  const typography = getDocsOgTypography(page.data.title, description);

  return new ImageResponse(
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '56px 64px 42px',
        color: '#fafafa',
        backgroundColor: '#050507',
        borderBottom: '14px solid #7cb9ea',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: `${docsOgLayout.contentHeight}px`,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            maxHeight: `${docsOgLayout.titleMaxHeight}px`,
            overflow: 'hidden',
            fontSize: `${typography.titleFontSize}px`,
            fontWeight: 700,
            letterSpacing: '-0.035em',
            lineHeight: 1.05,
          }}
        >
          {page.data.title}
        </div>
        {description && (
          <div
            style={{
              display: 'flex',
              flex: 1,
              marginTop: '22px',
              overflow: 'hidden',
              color: '#a1a1aa',
              fontSize: `${typography.descriptionFontSize}px`,
              lineHeight: 1.32,
            }}
          >
            {description}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexShrink: 0,
          width: '100%',
          height: '4px',
          marginTop: '20px',
          backgroundColor: '#7cb9ea',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          flexShrink: 0,
          height: `${docsOgLayout.footerHeight}px`,
          gap: '18px',
          marginTop: '24px',
          color: '#7cb9ea',
        }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="11" />
        </svg>
        <div style={{ display: 'flex', fontSize: '46px', fontWeight: 600 }}>
          {appName}
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
    },
  );
}

export function generateStaticParams() {
  return i18n.languages.flatMap((lang) =>
    source.getPages(lang).map((page) => ({
      lang,
      slug: getPageImage(page).segments,
    })),
  );
}
