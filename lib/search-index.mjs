async function getStructuredData(page) {
  if (page.data.structuredData) {
    return typeof page.data.structuredData === 'function'
      ? page.data.structuredData()
      : page.data.structuredData;
  }

  if ('load' in page.data && typeof page.data.load === 'function') {
    return (await page.data.load()).structuredData;
  }

  return undefined;
}

export async function buildDiscoveryIndex(page) {
  const structuredData = await getStructuredData(page);
  if (!structuredData) {
    throw new Error(`Cannot find structured search data for ${page.url}`);
  }

  return {
    title: page.data.title ?? page.url,
    description: page.data.description,
    url: page.url,
    id: page.url,
    structuredData: {
      ...structuredData,
      contents: [],
    },
  };
}
