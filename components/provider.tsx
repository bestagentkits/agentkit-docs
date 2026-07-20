'use client';
import SearchDialog from '@/components/search';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { type ReactNode } from 'react';

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      search={{ SearchDialog }}
      // AgentKit brand is dark-first (agentkit.best is dark-only); docs default
      // to dark for everyone, with light available via the theme toggle.
      theme={{ defaultTheme: 'dark', enableSystem: false }}
    >
      {children}
    </RootProvider>
  );
}
