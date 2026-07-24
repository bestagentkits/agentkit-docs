'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export interface TerminalLine {
  // 'cmd' renders with a $ prompt, 'out' is program output, 'comment' is muted
  kind: 'cmd' | 'out' | 'comment';
  text: string;
}

// Hero terminal: a real quickstart session (commands mirror the docs; the only
// output line is the released version). `.ak-terminal` keeps the dark code
// surface in light mode via the figure.shiki token override in global.css.
export function HomeTerminal({
  lines,
  copyCommand,
  copyLabel,
  copiedLabel,
}: {
  lines: TerminalLine[];
  copyCommand: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyCommand);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = copyCommand;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copiedWithFallback = document.execCommand('copy');
      textarea.remove();

      if (!copiedWithFallback) return;
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="ak-terminal ak-terminal-window overflow-hidden rounded-lg border border-fd-border bg-fd-card text-left">
      <div className="ak-terminal-bar flex items-center gap-1.5 border-b border-fd-border px-4 py-3">
        <span aria-hidden className="ak-terminal-light size-2 rounded-full" />
        <span aria-hidden className="ak-terminal-light size-2 rounded-full" />
        <span aria-hidden className="ak-terminal-light size-2 rounded-full" />
        <span className="ak-terminal-context ml-2 font-mono text-xs text-fd-muted-foreground">
          ak / quickstart
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? copiedLabel : copyLabel}
          className="ml-auto inline-flex size-11 items-center justify-center rounded-sm text-fd-muted-foreground transition-colors hover:bg-fd-secondary hover:text-fd-foreground"
        >
          {copied ? (
            <Check aria-hidden className="size-3.5 text-fd-success" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
          <span className="sr-only" aria-live="polite">
            {copied ? copiedLabel : ''}
          </span>
        </button>
      </div>
      <pre className="ak-terminal-body overflow-x-auto p-4 font-mono text-[13px] leading-6">
        {lines.map((line, i) => (
          <div key={i} data-line style={{ animationDelay: `${0.3 + i * 0.5}s` }}>
            {line.kind === 'cmd' ? (
              <>
                <span className="select-none text-fd-primary">$ </span>
                <span className="text-fd-foreground">{line.text}</span>
              </>
            ) : (
              <span className="text-fd-muted-foreground">{line.text}</span>
            )}
          </div>
        ))}
        <div data-line style={{ animationDelay: `${0.3 + lines.length * 0.5}s` }}>
          <span className="select-none text-fd-primary">$ </span>
          <span
            aria-hidden
            className="inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-fd-primary/70 motion-reduce:animate-none"
          />
        </div>
      </pre>
    </div>
  );
}
