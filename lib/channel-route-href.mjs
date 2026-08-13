export function channelRouteHref(locale, channel, remainder, targetExists) {
  const root = `/${locale}/${channel}`;
  if (!targetExists || remainder.length === 0) return root;
  return `${root}/${remainder.map((segment) => decodeURI(segment)).join('/')}`;
}

export function unavailableChannelUrls(pageUrls) {
  const urls = new Set(pageUrls);
  const unavailable = new Set();
  for (const url of urls) {
    const match = url.match(/^\/([^/]+)\/(stable|beta)(\/.*)?$/);
    if (!match) continue;
    const targetChannel = match[2] === 'stable' ? 'beta' : 'stable';
    const targetUrl = `/${match[1]}/${targetChannel}${match[3] ?? ''}`;
    if (!urls.has(targetUrl)) unavailable.add(targetUrl);
  }
  return [...unavailable].sort();
}
