'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';

type MermaidModule = typeof import('mermaid');

const mermaidModule = import('mermaid');
let renderQueue = Promise.resolve();

function queueRender<T>(render: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(render, render);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function getAccessibleTitle(chart: string): string | undefined {
  return chart.match(/^\s*accTitle:\s*(.+)$/m)?.[1]?.trim();
}

export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replaceAll(':', '');
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string>();
  const [failed, setFailed] = useState(false);
  const title = useMemo(() => getAccessibleTitle(chart), [chart]);
  const activeTheme = resolvedTheme === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    let active = true;
    setFailed(false);

    void queueRender(async () => {
      const { default: mermaid }: MermaidModule = await mermaidModule;
      const styles = getComputedStyle(document.documentElement);
      const token = (name: string) => styles.getPropertyValue(name).trim();

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        fontFamily: 'var(--font-sans)',
        theme: 'base',
        themeVariables: {
          background: token('--color-fd-background'),
          primaryColor: token('--color-fd-card'),
          primaryTextColor: token('--color-fd-card-foreground'),
          primaryBorderColor: token('--color-fd-primary'),
          lineColor: token('--color-fd-muted-foreground'),
          secondaryColor: token('--color-fd-muted'),
          secondaryTextColor: token('--color-fd-foreground'),
          tertiaryColor: token('--color-fd-accent'),
          tertiaryTextColor: token('--color-fd-accent-foreground'),
          edgeLabelBackground: token('--color-fd-background'),
        },
        flowchart: {
          htmlLabels: false,
          useMaxWidth: true,
        },
      });

      return mermaid.render(`ak-mermaid-${id}`, chart.replaceAll('\\n', '\n'));
    })
      .then(({ svg: rendered }) => {
        if (active) setSvg(rendered);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [activeTheme, chart, id]);

  return (
    <figure className="ak-mermaid">
      {svg && !failed ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <pre data-mermaid-fallback={failed ? 'error' : 'loading'}>
          <code>{chart}</code>
        </pre>
      )}
      {title && <figcaption>{title}</figcaption>}
    </figure>
  );
}
