import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

export const revalidate = false;

// One static index per locale (derived from the source's i18n config). Orama
// ships no Vietnamese tokenizer — left unmapped, the `vi` locale would resolve
// to an unsupported "vietnamese" language and fail the build — so `vi` reuses
// the English analyzer. It won't stem Vietnamese, but substring matching still
// works and the build stays green.
// https://docs.orama.com/docs/orama-js/supported-languages
export const { staticGET: GET } = createFromSource(source, {
  localeMap: {
    en: 'english',
    vi: 'english',
  },
});
