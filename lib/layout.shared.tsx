import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
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
