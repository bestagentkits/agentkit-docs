import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { localePath } from './locale-path';
import { appName, gitConfig } from './shared';

// Logo/home link stays inside the active locale. The language switcher is
// rendered by the layout from the i18n provider.
export function baseOptions(locale: string): BaseLayoutProps {
  return {
    nav: {
      url: localePath(locale),
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
