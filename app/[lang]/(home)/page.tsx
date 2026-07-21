import Link from 'next/link';
import { i18n } from '@/lib/i18n';

const copy = {
  en: {
    eyebrow: 'AgentKit CLI',
    title: 'Documentation for the ak CLI',
    body: 'Install the CLI, run your first agent, and browse the command reference — kept in sync with every release.',
    cta: 'Read the docs',
  },
  vi: {
    eyebrow: 'AgentKit CLI',
    title: 'Tài liệu cho công cụ dòng lệnh ak',
    body: 'Cài đặt CLI, chạy agent đầu tiên và tra cứu lệnh — luôn đồng bộ với mỗi bản phát hành.',
    cta: 'Đọc tài liệu',
  },
} as const;

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export default async function HomePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  const t = copy[lang as keyof typeof copy] ?? copy.en;

  return (
    <main className="flex flex-1 flex-col justify-center px-4 py-24 text-center">
      <p className="mb-4 font-mono text-xs font-medium uppercase tracking-[0.09em] text-fd-primary">
        {t.eyebrow}
      </p>
      <h1 className="mb-4 text-4xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mx-auto mb-8 max-w-xl text-fd-muted-foreground">{t.body}</p>
      <div>
        <Link
          href={`/${lang}/docs`}
          className="inline-flex items-center rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
        >
          {t.cta}
        </Link>
      </div>
    </main>
  );
}
