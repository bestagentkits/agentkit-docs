import { cache } from 'react';
import { DocsLayoutClient } from '@/components/docs-layout-client';
import { source } from '@/lib/source';

const getPageTree = cache((lang: string) => source.getPageTree(lang));

export default async function Layout({
  params,
  children,
}: LayoutProps<'/[lang]'>) {
  const { lang } = await params;

  return (
    <DocsLayoutClient tree={getPageTree(lang)} locale={lang}>
      {children}
    </DocsLayoutClient>
  );
}
