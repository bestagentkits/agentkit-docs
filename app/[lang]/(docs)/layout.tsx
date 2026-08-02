import { ProductDocsLayout } from '@/components/product-docs-layout';
import { source } from '@/lib/source';
import type { SerializedPageTree } from 'fumadocs-core/source/client';

export default async function Layout({
  params,
  children,
}: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  // serializePageTree converts React name/icon nodes to HTML strings, but
  // object spread still copies enumerable Symbol keys (e.g. Symbol("name")
  // left on CLI-nested pages). JSON round-trip drops those so the prop is a
  // plain object Flight can pass to the client layout.
  const tree = JSON.parse(
    JSON.stringify(await source.serializePageTree(source.getPageTree(lang))),
  ) as SerializedPageTree;

  return (
    <ProductDocsLayout locale={lang} tree={tree}>
      {children}
    </ProductDocsLayout>
  );
}
