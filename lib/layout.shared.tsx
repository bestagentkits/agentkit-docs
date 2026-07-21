import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

// `locale` prefixes internal nav links so the logo/home link stays inside the
// active language (/en, /vi). The language switcher itself is rendered by the
// layout from the i18n provider context, so it needs no config here.
export function baseOptions(locale: string): BaseLayoutProps {
  return {
    nav: {
      url: `/${locale}`,
      title: (
        <>
          {/* Real AgentKit logo mark (public/logo-icon.svg). Plain <img> so it
              works under static export without the Image Optimization server. */}
          <img
            src="/logo-icon.svg"
            alt=""
            width={22}
            height={22}
            className="shrink-0"
          />
          <span className="font-medium">{appName}</span>
        </>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
