type CliReferencePage = {
  data: { title?: unknown };
  url: string;
};

const legacyCliHref = /\/cli\/(ak_[^/#]+)$/;
const legacyCliLinks = /\.\.\/cli\/(ak_[A-Za-z0-9_-]+)(#[^\s)]*)?/g;

function commandTitleFromLegacySlug(slug: string): string {
  return decodeURIComponent(slug).replaceAll('_', ' ');
}

export function resolveLegacyCliReferenceHref(
  href: string | undefined,
  pages: CliReferencePage[],
): string | undefined {
  if (!href) return href;

  const hashIndex = href.indexOf('#');
  const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
  const match = legacyCliHref.exec(path);
  if (!match) return undefined;

  const title = commandTitleFromLegacySlug(match[1]);
  const page = pages.find(
    (candidate) =>
      candidate.data.title === title &&
      candidate.url.includes('/reference/cli/'),
  );
  return page ? `${page.url}${hash}` : undefined;
}

export function rewriteLegacyCliReferenceLinks(
  markdown: string,
  pages: CliReferencePage[],
): string {
  return markdown.replace(legacyCliLinks, (href) => {
    return resolveLegacyCliReferenceHref(href, pages) ?? href;
  });
}
