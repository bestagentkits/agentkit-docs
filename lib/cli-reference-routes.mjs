const channels = ['stable', 'beta'];

function pageStem(filePath) {
  return filePath
    .split('/')
    .at(-1)
    ?.replace(/\.(?:en|vi)\.mdx?$/, '')
    .replace(/\.mdx?$/, '');
}

function hrefChannel(href, parentPath) {
  return (
    /\/(stable|beta)\/reference\/cli/.exec(href)?.[1] ??
    channels.find((channel) => parentPath?.startsWith(`${channel}/`))
  );
}

/**
 * Resolve relative/legacy CLI reference hrefs onto published nested URLs.
 * Supports:
 * - `../reference/cli` (root)
 * - `../reference/cli/gui` or nested `../reference/cli/config/prefs/set`
 * - legacy flat `../reference/cli-samples/ak%20gui` / `./doctor`
 * - legacy generated `../reference/cli/ak_kit_init`
 */
export function resolveCliReferenceHref(href, pages, parentPath) {
  if (!href) return href;

  const hashIndex = href.indexOf('#');
  const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex);

  const root = /\/reference\/cli(?:-samples)?$/.test(path);
  const generated = /\/cli\/(ak_[^/#]+)$/.exec(path);
  const nested = /\/reference\/cli\/(.+)$/.exec(path);
  const legacyFlat = /\/reference\/cli-samples\/([^/#]+)$/.exec(path);
  const relativeFlat =
    /^(?:\.\.\/|\.\/)/.test(path) &&
    /^(?:stable|beta)\/reference\/cli\//.test(parentPath ?? '')
      ? path.split('/').at(-1)
      : undefined;
  if (!root && !generated && !nested && !legacyFlat && !relativeFlat) return undefined;

  let expectedTitle;
  let expectedSlugsSuffix;
  let expectedStem;
  try {
    if (generated) {
      expectedTitle = decodeURIComponent(generated[1]).replaceAll('_', ' ');
    } else if (legacyFlat) {
      expectedStem = decodeURIComponent(legacyFlat[1]);
    } else if (relativeFlat) {
      expectedStem = decodeURIComponent(relativeFlat);
    } else if (nested) {
      expectedSlugsSuffix = decodeURIComponent(nested[1])
        .split('/')
        .filter(Boolean);
    }
  } catch {
    return undefined;
  }

  const channel = hrefChannel(path, parentPath);
  const isEligible = (candidate) => {
    if (!candidate.url.includes('/reference/cli')) return false;
    if (channel && !candidate.path?.startsWith(`${channel}/`)) return false;
    return true;
  };
  const findByStem = (stem) => {
    if (!stem || stem === 'index') return undefined;
    const directTitle = stem.startsWith('ak ') ? stem : `ak ${stem}`;
    const direct = pages.find(
      (page) => isEligible(page) && page.data.title === directTitle,
    );
    if (direct) return direct;

    const normalizedStem = stem.replaceAll('-', ' ');
    return pages.find((page) => {
      if (!isEligible(page) || typeof page.data.title !== 'string') return false;
      return page.data.title
        .replace(/^ak /, '')
        .replaceAll('-', ' ') === normalizedStem;
    });
  };

  if (expectedStem && expectedStem !== 'index') {
    const page = findByStem(expectedStem);
    return page ? `${page.url}${hash}` : undefined;
  }

  let page = pages.find((candidate) => {
    if (!isEligible(candidate)) return false;
    if (root) {
      const slugs = candidate.slugs ?? [];
      return (
        slugs.length >= 3 &&
        slugs.at(-3) === channel &&
        slugs.at(-2) === 'reference' &&
        slugs.at(-1) === 'cli'
      ) || (
        !channel &&
        slugs.at(-2) === 'reference' &&
        slugs.at(-1) === 'cli'
      );
    }
    if (expectedTitle) return candidate.data.title === expectedTitle;
    if (expectedStem) {
      return pageStem(candidate.path ?? '') === 'index';
    }
    if (expectedSlugsSuffix) {
      const slugs = candidate.slugs ?? [];
      const cliIndex = slugs.indexOf('cli');
      if (cliIndex === -1) return false;
      const suffix = slugs.slice(cliIndex + 1);
      if (
        suffix.length === expectedSlugsSuffix.length &&
        suffix.every((part, i) => part === expectedSlugsSuffix[i])
      ) {
        return true;
      }
    }
    return false;
  });
  // A one-segment nested-style link can still use a legacy hyphenated stem.
  // Match it against the command title within the same channel.
  if (!page && expectedSlugsSuffix?.length === 1) {
    page = findByStem(expectedSlugsSuffix[0]);
  }
  return page ? `${page.url}${hash}` : undefined;
}

export function legacyCliSamplesParentPath(parentPath) {
  const match = /^(stable|beta)\/reference\/cli\/.+\.(en|vi)\.mdx?$/.exec(
    parentPath ?? '',
  );
  return match
    ? `${match[1]}/reference/cli-samples/__legacy__.${match[2]}.mdx`
    : undefined;
}

export function cliCommandSegmentsFromTitle(title) {
  if (typeof title !== 'string' || !title.startsWith('ak ')) {
    throw new Error(`CLI reference title must start with "ak ": ${String(title)}`);
  }
  const segments = title.slice(3).split(/\s+/);
  for (const segment of segments) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(segment)) {
      throw new Error(`Invalid CLI command segment "${segment}" in title: ${title}`);
    }
  }
  return segments;
}
