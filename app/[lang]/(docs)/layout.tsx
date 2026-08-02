import { ProductDocsLayout } from '@/components/product-docs-layout';
import { source } from '@/lib/source';

export default async function Layout({
  params,
  children,
}: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  const tree = await source.serializePageTree(source.getPageTree(lang));

  return (
    <ProductDocsLayout locale={lang} tree={tree}>
      {children}
    </ProductDocsLayout>
  );
}
