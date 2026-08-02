import { ProductDocsLayout } from '@/components/product-docs-layout';
import { source } from '@/lib/source';

export default async function Layout({
  params,
  children,
}: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  return (
    <ProductDocsLayout locale={lang} tree={source.getPageTree(lang)}>
      {children}
    </ProductDocsLayout>
  );
}
