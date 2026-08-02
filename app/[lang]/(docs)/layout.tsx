import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { ChannelSelector } from '@/components/channel-selector';

export default async function Layout({
  params,
  children,
}: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  return (
    <DocsLayout
      tree={source.getPageTree(lang)}
      tabs={false}
      sidebar={{ banner: <ChannelSelector locale={lang} /> }}
      {...baseOptions(lang)}
    >
      {children}
    </DocsLayout>
  );
}
