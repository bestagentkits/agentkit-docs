import { DocsLayoutClient } from '@/components/docs-layout-client';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

export default async function Layout({
  params,
  children,
}: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  const options = baseOptions(lang);

  return (
    <DocsLayoutClient tree={source.getPageTree(lang)} locale={lang} baseOptions={options}>
      {children}
    </DocsLayoutClient>
  );
}
