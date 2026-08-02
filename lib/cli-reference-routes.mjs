const channels = ['stable', 'beta'];
const sourceSegment = 'cli-samples';

function commandSegments(title) {
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

function pageStem(filePath) {
  return filePath
    .split('/')
    .at(-1)
    ?.replace(/\.(?:en|vi)\.mdx?$/, '')
    .replace(/\.mdx?$/, '');
}

export function canonicalCliReferenceSlugs(storagePath, title) {
  const parts = storagePath.split('/');
  const sourceIndex = parts.indexOf(sourceSegment);
  if (sourceIndex === -1) return undefined;

  const stem = pageStem(storagePath);
  if (!stem) throw new Error(`Cannot derive CLI source filename: ${storagePath}`);
  const suffix = stem === 'index' ? [] : commandSegments(title);
  return [...parts.slice(0, sourceIndex), 'cli', ...suffix];
}

export function transformCliReferenceStorage(storage) {
  for (const channel of channels) {
    storage.delete(`${channel}/reference/cli`, true);
  }

  const authoredPaths = storage
    .getFiles()
    .filter((filePath) => filePath.includes(`/reference/${sourceSegment}/`));
  const taken = new Map();

  for (const filePath of storage.getFiles()) {
    if (authoredPaths.includes(filePath)) continue;
    const file = storage.read(filePath);
    if (file?.format === 'page') taken.set(file.slugs.join('/'), filePath);
  }

  for (const filePath of authoredPaths) {
    const file = storage.read(filePath);
    if (file?.format !== 'page') continue;

    const slugs = canonicalCliReferenceSlugs(filePath, file.data.title);
    const route = slugs.join('/');
    const collision = taken.get(route);
    if (collision) {
      throw new Error(
        `Duplicate canonical CLI route "${route}": ${collision}, ${filePath}`,
      );
    }
    taken.set(route, filePath);
    file.slugs = slugs;
  }
}

function commandPathFromUrl(url) {
  const pathname = new URL(url, 'https://docs.agentkit.best').pathname;
  const marker = '/reference/cli';
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex === -1) throw new Error(`Not a canonical CLI URL: ${url}`);

  const tail = pathname.slice(markerIndex + marker.length).replace(/^\//, '');
  if (!tail) return [];
  const segments = tail.split('/').map(decodeURIComponent);
  if (segments.some((segment) => !/^[a-z0-9][a-z0-9-]*$/.test(segment))) {
    throw new Error(`Invalid canonical CLI URL: ${url}`);
  }
  return segments;
}

export function nestCliReferencePageTree(folder) {
  const root = { children: new Map() };
  let rootPage = folder.index;

  for (const page of folder.children) {
    if (page.type !== 'page') {
      throw new Error('Authored CLI source tree must be flat before nesting');
    }

    const segments = commandPathFromUrl(page.url);
    if (segments.length === 0) {
      if (rootPage) throw new Error(`Duplicate CLI root page: ${page.url}`);
      rootPage = page;
      continue;
    }
    let cursor = root;
    for (const segment of segments) {
      let child = cursor.children.get(segment);
      if (!child) {
        child = { segment, children: new Map() };
        cursor.children.set(segment, child);
      }
      cursor = child;
    }
    if (cursor.page) throw new Error(`Duplicate CLI page-tree URL: ${page.url}`);
    cursor.page = page;
  }

  function materialize(entry, depth, parentId) {
    const name = depth === 1 ? `ak ${entry.segment}` : entry.segment;
    const page = entry.page ? { ...entry.page, name } : undefined;
    const children = [...entry.children.values()].map((child) =>
      materialize(child, depth + 1, `${parentId}/${entry.segment}`),
    );
    if (children.length === 0) {
      if (!page) throw new Error(`CLI command group has no authored page: ${name}`);
      return page;
    }
    return {
      type: 'folder',
      $id: `${parentId}:command:${entry.segment}`,
      name,
      index: page,
      children,
    };
  }

  return {
    ...folder,
    index: rootPage,
    children: [...root.children.values()].map((entry) =>
      materialize(entry, 1, folder.$id ?? 'cli-reference'),
    ),
  };
}

function hrefChannel(href, parentPath) {
  return (
    /\/(stable|beta)\/reference\/cli/.exec(href)?.[1] ??
    channels.find((channel) => parentPath?.startsWith(`${channel}/`))
  );
}

export function resolveCliReferenceHref(href, pages, parentPath) {
  if (!href) return href;

  const hashIndex = href.indexOf('#');
  const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
  const root = /\/reference\/cli(?:-samples)?$/.test(path);
  const generated = /\/cli\/(ak_[^/#]+)$/.exec(path);
  const authored = /\/reference\/cli(?:-samples)?\/([^/#]+)$/.exec(path);
  if (!root && !generated && !authored) return undefined;

  let expectedTitle;
  let expectedStem;
  try {
    expectedTitle = generated
      ? decodeURIComponent(generated[1]).replaceAll('_', ' ')
      : undefined;
    expectedStem = authored ? decodeURIComponent(authored[1]) : undefined;
  } catch {
    return undefined;
  }

  const channel = hrefChannel(path, parentPath);
  const page = pages.find((candidate) => {
    if (!candidate.url.includes('/reference/cli')) return false;
    if (channel && !candidate.path?.startsWith(`${channel}/`)) return false;
    return expectedTitle
      ? candidate.data.title === expectedTitle
      : pageStem(candidate.path ?? '') === (root ? 'index' : expectedStem);
  });
  return page ? `${page.url}${hash}` : undefined;
}

export function cliCommandSegmentsFromTitle(title) {
  return commandSegments(title);
}
