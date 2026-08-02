'use client';

import { cn } from '@/lib/cn';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import type { ThemeSwitchProps } from 'fumadocs-ui/layouts/shared/slots/theme-switch';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function AccessibleThemeSwitch({
  className,
  mode: _mode,
}: ThemeSwitchProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { locale } = useI18n();
  const [mounted, setMounted] = useState(false);
  const isDark = mounted && resolvedTheme === 'dark';
  const current = isDark ? 'dark' : 'light';
  const label =
    locale === 'vi'
      ? mounted
        ? `Giao diện hiện tại: ${isDark ? 'tối' : 'sáng'}. Chuyển giao diện`
        : 'Chuyển giao diện'
      : mounted
        ? `Current theme: ${current}. Switch theme`
        : 'Switch theme';

  useEffect(() => setMounted(true), []);

  return (
    <button
      type="button"
      data-theme-toggle=""
      data-theme-current={mounted ? current : undefined}
      aria-label={label}
      aria-pressed={mounted ? isDark : undefined}
      className={cn(
        'inline-flex items-center rounded-full border p-1 text-fd-muted-foreground overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring',
        className,
      )}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      <Sun
        aria-hidden="true"
        className={cn(
          'size-6.5 rounded-full p-1.5',
          mounted && !isDark && 'bg-fd-accent text-fd-accent-foreground',
        )}
      />
      <Moon
        aria-hidden="true"
        className={cn(
          'size-6.5 rounded-full p-1.5',
          isDark && 'bg-fd-accent text-fd-accent-foreground',
        )}
      />
    </button>
  );
}
