'use client';
import SearchDialog from '@/components/search';
import { i18n } from '@/lib/i18n';
import { FrameworkProvider, type Framework } from 'fumadocs-core/framework';
import { defineI18nUI } from 'fumadocs-ui/i18n';
import { RootProvider } from 'fumadocs-ui/provider/base';
import Image from 'next/image';
import Link from 'next/link';
import {
  useParams,
  usePathname as useNextPathname,
  useRouter,
} from 'next/navigation';
import { type ReactNode } from 'react';

const FrameworkLink = Link as Framework['Link'];
const FrameworkImage = Image as Framework['Image'];

// Language-switcher labels + a few of the most visible UI strings in Vietnamese.
// Un-overridden keys fall back to Fumadocs' built-in English strings — acceptable
// while VI is a fast-follow.
const { provider } = defineI18nUI(i18n, {
  en: { displayName: 'English' },
  vi: {
    displayName: 'Tiếng Việt',
    search: 'Tìm kiếm',
    searchNoResult: 'Không có kết quả',
    toc: 'Trên trang',
    lastUpdate: 'Cập nhật lần cuối',
    chooseLanguage: 'Chọn ngôn ngữ',
    nextPage: 'Trang sau',
    previousPage: 'Trang trước',
    chooseTheme: 'Giao diện',
    editOnGithub: 'Sửa trên GitHub',
  },
});

function useCanonicalPathname(): string {
  const pathname = useNextPathname();

  if (pathname === '/en') return '/';
  if (pathname.startsWith('/en/')) return pathname.slice('/en'.length);
  return pathname;
}

export function Provider({
  children,
  locale,
}: {
  children: ReactNode;
  locale: string;
}) {
  return (
    <FrameworkProvider
      Link={FrameworkLink}
      Image={FrameworkImage}
      useParams={useParams}
      usePathname={useCanonicalPathname}
      useRouter={useRouter}
    >
      <RootProvider
        search={{ SearchDialog }}
        i18n={provider(locale)}
        // AgentKit brand is dark-first (agentkit.best is dark-only); docs default
        // to dark for everyone, with light available via the theme toggle.
        theme={{ defaultTheme: 'dark', enableSystem: false }}
      >
        {children}
      </RootProvider>
    </FrameworkProvider>
  );
}
