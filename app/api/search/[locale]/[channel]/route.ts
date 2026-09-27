import { createSearchAPI } from 'fumadocs-core/search/server';
import { SEARCH_LANGUAGE } from '@/lib/search-client.mjs';
import { SEARCH_SHARD_DATABASE_OPTIONS, buildScopedDiscoveryIndex } from '@/lib/search-index.mjs';
import { SEARCH_SCOPES } from '@/lib/search-scopes.mjs';
import { source } from '@/lib/source';

export const revalidate = false;
export const dynamic = 'force-static';

// One prerendered Orama export per supported locale/channel pair. Each shard
// contains only the pages served under its own `/{locale}/{channel}` prefix, so
// a search can never return another channel's or locale's records.
export function generateStaticParams() {
  return SEARCH_SCOPES.map(({ locale, channel }) => ({ locale, channel }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; channel: string }> },
) {
  const { locale, channel } = await params;
  const indexes = await buildScopedDiscoveryIndex(source, locale, channel);

  // Orama ships no Vietnamese tokenizer — left unmapped, the `vi` locale would
  // resolve to an unsupported "vietnamese" language and fail the build — so
  // both locales use the English analyzer. It won't stem Vietnamese, but
  // substring matching still works and the build stays green.
  // https://docs.orama.com/docs/orama-js/supported-languages
  const { staticGET } = createSearchAPI('advanced', {
    indexes,
    language: SEARCH_LANGUAGE,
    ...SEARCH_SHARD_DATABASE_OPTIONS,
  });

  return staticGET();
}
