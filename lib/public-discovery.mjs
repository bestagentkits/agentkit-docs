/**
 * @param {{ data?: { discoverable?: boolean } }} page
 */
export function isPubliclyDiscoverablePage(page) {
  return page.data?.discoverable !== false;
}

/**
 * @template {{ data?: { discoverable?: boolean } }} Page
 * @param {Page[]} pages
 * @returns {Page[]}
 */
export function filterPublicDiscoveryPages(pages) {
  return pages.filter(isPubliclyDiscoverablePage);
}

/**
 * @template {{ getPages: (...args: any[]) => Array<{ data?: { discoverable?: boolean } }> }} Source
 * @param {Source} source
 * @returns {Source}
 */
export function createPublicDiscoverySource(source) {
  return new Proxy(source, {
    get(target, property, receiver) {
      if (property === 'getPages') {
        return (...args) =>
          filterPublicDiscoveryPages(target.getPages(...args));
      }

      return Reflect.get(target, property, receiver);
    },
  });
}
