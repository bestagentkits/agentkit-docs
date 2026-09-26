// Search scope identity: which locale + release channel shard a page, a route
// or a query belongs to.
//
// Every search surface reads the same four shards, so the scope vocabulary
// lives in one dependency-free module shared by the browser client
// (`lib/search-client.mjs`), the static shard route, the build-time index
// builder (`lib/search-index.mjs`), the component that reads the current route,
// and the asset/quality guards. Nothing here may import Node or React APIs.

export const SEARCH_LOCALES = Object.freeze(['en', 'vi']);
export const SEARCH_CHANNELS = Object.freeze(['stable', 'beta']);

// The endpoint base that the shards are served under.
export const SEARCH_ENDPOINT_BASE = '/api/search';

// Pages outside a channel route (for example the unlisted `_showcase` visual QA
// page) search against the default channel of the locale they are rendered in.
export const DEFAULT_SEARCH_CHANNEL = 'stable';
export const DEFAULT_SEARCH_LOCALE = 'en';

export const SEARCH_SCOPES = Object.freeze(
  SEARCH_LOCALES.flatMap((locale) =>
    SEARCH_CHANNELS.map((channel) => Object.freeze({ locale, channel })),
  ),
);

export function searchScopeKey(locale, channel) {
  return `${locale}/${channel}`;
}

export function isSearchLocale(locale) {
  return SEARCH_LOCALES.includes(locale);
}

export function isSearchChannel(channel) {
  return SEARCH_CHANNELS.includes(channel);
}

export function isSupportedSearchScope(locale, channel) {
  return isSearchLocale(locale) && isSearchChannel(channel);
}

// Unsupported tuples must never invent a URL or silently fall back to another
// locale/channel: they are a programming error, not a runtime condition.
export function assertSupportedSearchScope(locale, channel) {
  if (!isSupportedSearchScope(locale, channel)) {
    throw new Error(
      `unsupported search scope ${locale}/${channel}; expected one of ${SEARCH_SCOPES.map(
        (scope) => searchScopeKey(scope.locale, scope.channel),
      ).join(', ')}`,
    );
  }
}

export function searchScopePrefix(locale, channel) {
  return `/${locale}/${channel}`;
}

// Path of one scope's static shard, relative to the static output root.
export function searchShardPath(locale, channel) {
  return `api/search/${locale}/${channel}`;
}

// URL the browser fetches for one scope.
export function searchShardUrl(locale, channel, base = SEARCH_ENDPOINT_BASE) {
  return `${base}/${locale}/${channel}`;
}

export function searchShardPaths() {
  return SEARCH_SCOPES.map(({ locale, channel }) => searchShardPath(locale, channel));
}

function segmentsOf(value) {
  return value.split('/').filter(Boolean);
}

// Locale/channel a docs page URL belongs to, or `null` when the URL is a real
// page that lives outside every channel (for example the unlisted
// `_showcase`). A URL that is not even locale-prefixed is malformed input for
// search and throws instead of being silently dropped or indexed into the
// wrong scope.
//
// Only canonical local paths are accepted. `//en/stable/x` is a network-path
// reference (a browser resolves it against host `en`), and `/en/stable/../../vi/beta/x`
// resolves into another scope, so both would classify as Stable while the
// browser navigates elsewhere.
export function pageScopeFromUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/')) {
    throw new Error(`malformed docs URL: ${String(url)}`);
  }
  if (url.startsWith('//')) {
    throw new Error(`docs URL is a network-path reference, not a local path: ${url}`);
  }

  const segments = url.split('#')[0].split('?')[0].slice(1).split('/');
  for (const segment of segments) {
    if (!isCanonicalPathSegment(segment)) {
      throw new Error(`docs URL is not a canonical local path: ${url}`);
    }
  }

  const [locale, segment] = segments;
  if (!isSearchLocale(locale)) {
    throw new Error(`docs URL is not prefixed with a supported locale: ${url}`);
  }

  return isSearchChannel(segment) ? { locale, channel: segment } : null;
}

// A path segment that resolves to itself: not empty, not a `.`/`..` traversal
// (raw or percent-encoded), and not hiding a separator behind an encoding.
function isCanonicalPathSegment(segment) {
  if (segment === '' || /^(?:\.|%2e){1,2}$/i.test(segment)) return false;

  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }

  return decoded !== '' && decoded !== '.' && decoded !== '..' && !/[/\\]/.test(decoded);
}

// Scope of the page currently being read. Routes outside a channel use the
// default channel policy for their supported locale; an unknown locale falls
// back to the supported default.
export function searchScopeFromPathname(pathname, fallbackLocale = DEFAULT_SEARCH_LOCALE) {
  const [first, second] = segmentsOf(typeof pathname === 'string' ? pathname : '');
  const locale = isSearchLocale(first)
    ? first
    : isSearchLocale(fallbackLocale)
      ? fallbackLocale
      : DEFAULT_SEARCH_LOCALE;
  const channel = isSearchChannel(second) ? second : DEFAULT_SEARCH_CHANNEL;

  return { locale, channel };
}
