#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/paths.mjs';

export const RELEASE_SHAPE_BASELINE = Object.freeze({
  schemaVersion: 1,
  reviewedAt: '2026-08-13',
  sourceCommit: 'e1f84b0b0203cb2578aad2e0c9b9b708233ec2c2',
  channels: ['beta', 'stable'],
  locales: ['en', 'vi'],
  // Per-channel: stable stays bound to channels.stable.tag; beta may include
  // routes authored ahead of the next stable promote. Beta must remain a
  // superset of stable so a whole-copy promote is safe.
  sourceRoutesPerLocaleChannel: { stable: 393, beta: 398 },
  routesPerLocaleChannel: { stable: 392, beta: 397 },
  reviewedSourceOnlyRoutes: [
    {
      route: 'changelog',
      classification: 'reviewed-unpublished-navigation-source',
      rationale: 'The changelog source supports navigation data and does not publish a standalone route.',
    },
    {
      route: 'reference/release-notes',
      classification: 'reviewed-unpublished-release-source',
      rationale: 'Release-note source data is composed into other pages and does not publish a standalone route.',
    },
  ],
  reviewedGeneratedRoutes: [
    {
      route: 'reference/cli/ak',
      classification: 'reviewed-legacy-redirect',
      rationale: 'The built locale-aware compatibility redirect has no authored MDX source.',
    },
  ],
  reviewedVariants: [
    {
      route: 'reference/cli-conventions',
      en: 'shared-default',
      vi: 'native',
      classification: 'reviewed-shared-default-with-vi-override',
      rationale: 'English owns the channel-neutral source while Vietnamese has a reviewed localized body.',
    },
    {
      route: 'reference/cli/ak',
      en: 'generated-redirect',
      vi: 'generated-redirect',
      classification: 'reviewed-legacy-redirect',
      rationale: 'The legacy CLI root is a generated locale-aware redirect to reference/cli.',
    },
  ],
});

function sorted(values) {
  return [...values].sort();
}

function addSetDifference(errors, label, expected, actual) {
  const missing = sorted([...expected].filter((value) => !actual.has(value)));
  const extra = sorted([...actual].filter((value) => !expected.has(value)));
  if (missing.length || extra.length) {
    errors.push(`${label}: missing [${missing.join(', ')}]; extra [${extra.join(', ')}]`);
  }
}

// Assert `actual` contains every value in `expected` (i.e., actual ⊇ expected).
// Extra values in `actual` are allowed. Used for cross-channel comparison where
// beta may include routes authored ahead of the next stable promote but must
// still contain every stable route so a whole-copy promote is safe.
function addMissingSubset(errors, label, expected, actual) {
  const missing = sorted([...expected].filter((value) => !actual.has(value)));
  if (missing.length) {
    errors.push(`${label}: missing [${missing.join(', ')}]`);
  }
}

async function collectMdx(directory, root = directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectMdx(path, root, files);
    else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      files.push(relative(root, path).split(sep).join('/'));
    }
  }
  return files;
}

async function collectHtml(directory, root = directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectHtml(path, root, files);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(relative(root, path).split(sep).join('/').slice(0, -'.html'.length));
    }
  }
  return files;
}

export async function collectPublishedChannelRoutes(outDir, channel, locales) {
  const routes = {};
  for (const locale of locales) {
    const outputChannelDir = join(outDir, locale, channel);
    const rootPage = join(outDir, locale, `${channel}.html`);
    routes[locale] = new Set(existsSync(outputChannelDir) ? await collectHtml(outputChannelDir) : []);
    if (existsSync(rootPage)) routes[locale].add('');
  }
  return routes;
}

function parseVariant(path) {
  const match = path.match(/^(.*)\.(en|vi)\.mdx$/);
  const sourceRoute = match ? match[1] : path.slice(0, -'.mdx'.length);
  const route = sourceRoute === 'index'
    ? ''
    : sourceRoute.endsWith('/index')
      ? sourceRoute.slice(0, -'/index'.length)
      : sourceRoute;
  return { route, variant: match ? match[2] : 'shared' };
}

function resolveVariant(variants, locale) {
  if (variants.has(locale)) return 'native';
  if (locale === 'en' && variants.has('shared')) return 'shared-default';
  if (locale === 'vi' && variants.has('en')) return 'english-fallback';
  if (variants.has('shared')) return 'shared-fallback';
  return null;
}

function variantKey(entry) {
  return `${entry.route}\u0000${entry.en}\u0000${entry.vi}\u0000${entry.classification}`;
}

async function observeChannel(channelDir, outDir, channel, locales) {
  const variantsByRoute = new Map();
  for (const path of await collectMdx(channelDir)) {
    const { route, variant } = parseVariant(path);
    const variants = variantsByRoute.get(route) ?? new Set();
    variants.add(variant);
    variantsByRoute.set(route, variants);
  }

  const routes = await collectPublishedChannelRoutes(outDir, channel, locales);
  const sourceRoutes = {};
  const resolutions = new Map();
  for (const locale of locales) {
    sourceRoutes[locale] = new Set(
      [...variantsByRoute]
        .filter(([, variants]) => resolveVariant(variants, locale) !== null)
        .map(([route]) => route),
    );
  }
  for (const route of new Set(locales.flatMap((locale) => [...routes[locale]]))) {
    const variants = variantsByRoute.get(route);
    const localeResolutions = {};
    for (const locale of locales) {
      const resolution = route === 'reference/cli/ak' && !variants
        ? 'generated-redirect'
        : variants
          ? resolveVariant(variants, locale)
          : null;
      localeResolutions[locale] = resolution;
    }
    resolutions.set(route, localeResolutions);
  }
  return { resolutions, routes, sourceRoutes };
}

function observedReviewedVariants(observation) {
  const entries = [];
  for (const [route, resolutions] of observation.resolutions) {
    if (resolutions.en === 'native' && resolutions.vi === 'native') continue;
    let classification = 'unreviewed-locale-variant';
    if (resolutions.en === 'shared-default' && resolutions.vi === 'native') {
      classification = 'reviewed-shared-default-with-vi-override';
    } else if (resolutions.en === 'generated-redirect' && resolutions.vi === 'generated-redirect') {
      classification = 'reviewed-legacy-redirect';
    } else if (resolutions.vi === 'english-fallback') {
      classification = 'reviewed-english-fallback';
    }
    entries.push({ route, en: resolutions.en, vi: resolutions.vi, classification });
  }
  return entries.sort((left, right) => left.route.localeCompare(right.route));
}

export async function inspectReleaseShape({
  docsRoot = join(repoRoot, 'content', 'docs'),
  outDir = join(repoRoot, 'out'),
  baseline = RELEASE_SHAPE_BASELINE,
} = {}) {
  const errors = [];
  if (baseline.schemaVersion !== 1) errors.push(`unsupported baseline schemaVersion ${baseline.schemaVersion}`);
  const observations = {};
  for (const channel of baseline.channels) {
    const channelDir = join(docsRoot, channel);
    if (!existsSync(channelDir)) {
      errors.push(`${channel}: channel directory is missing`);
      continue;
    }
    observations[channel] = await observeChannel(channelDir, outDir, channel, baseline.locales);
    const referenceSourceRoutes = observations[channel].sourceRoutes[baseline.locales[0]];
    const referenceRoutes = observations[channel].routes[baseline.locales[0]];
    for (const locale of baseline.locales.slice(1)) {
      addSetDifference(
        errors,
        `${channel} ${baseline.locales[0]}/${locale} source route shape`,
        referenceSourceRoutes,
        observations[channel].sourceRoutes[locale],
      );
      addSetDifference(
        errors,
        `${channel} ${baseline.locales[0]}/${locale} route shape`,
        referenceRoutes,
        observations[channel].routes[locale],
      );
    }
    for (const locale of baseline.locales) {
      const sourceCount = observations[channel].sourceRoutes[locale].size;
      const expectedSourceCount = baseline.sourceRoutesPerLocaleChannel[channel];
      if (sourceCount !== expectedSourceCount) {
        errors.push(`${channel}/${locale}: source route count ${sourceCount} does not match reviewed baseline ${expectedSourceCount}`);
      }
      const count = observations[channel].routes[locale].size;
      const expectedCount = baseline.routesPerLocaleChannel[channel];
      if (count !== expectedCount) {
        errors.push(`${channel}/${locale}: route count ${count} does not match reviewed baseline ${expectedCount}`);
      }

      const sourceOnly = new Set(
        [...observations[channel].sourceRoutes[locale]]
          .filter((route) => !observations[channel].routes[locale].has(route)),
      );
      const generated = new Set(
        [...observations[channel].routes[locale]]
          .filter((route) => !observations[channel].sourceRoutes[locale].has(route)),
      );
      addSetDifference(
        errors,
        `${channel}/${locale} reviewed source-only routes`,
        new Set(baseline.reviewedSourceOnlyRoutes.map((entry) => entry.route)),
        sourceOnly,
      );
      addSetDifference(
        errors,
        `${channel}/${locale} reviewed generated routes`,
        new Set(baseline.reviewedGeneratedRoutes.map((entry) => entry.route)),
        generated,
      );
    }
  }

  // Cross-channel guarantee: every stable route must exist in beta so a
  // whole-copy promote stays safe. Extra beta-only routes (features authored
  // ahead of the next promote) are allowed.
  const stableChannel = observations.stable;
  const betaChannel = observations.beta;
  if (stableChannel && betaChannel) {
    for (const locale of baseline.locales) {
      addMissingSubset(
        errors,
        `stable ⊆ beta ${locale} source route shape`,
        stableChannel.sourceRoutes[locale],
        betaChannel.sourceRoutes[locale],
      );
      addMissingSubset(
        errors,
        `stable ⊆ beta ${locale} route shape`,
        stableChannel.routes[locale],
        betaChannel.routes[locale],
      );
    }
  }

  const expectedVariants = new Set(baseline.reviewedVariants.map(variantKey));
  const variantsByChannel = {};
  for (const channel of baseline.channels) {
    if (!observations[channel]) continue;
    const variants = observedReviewedVariants(observations[channel]);
    variantsByChannel[channel] = variants;
    addSetDifference(
      errors,
      `${channel} reviewed locale variants`,
      expectedVariants,
      new Set(variants.map(variantKey)),
    );
  }

  if (errors.length) throw new Error(`Release route-shape check failed:\n- ${errors.sort().join('\n- ')}`);
  return {
    baseline: {
      reviewedAt: baseline.reviewedAt,
      sourceCommit: baseline.sourceCommit,
      sourceRoutesPerLocaleChannel: baseline.sourceRoutesPerLocaleChannel,
      routesPerLocaleChannel: baseline.routesPerLocaleChannel,
    },
    channels: Object.fromEntries(
      baseline.channels.map((channel) => [
        channel,
        Object.fromEntries(
          baseline.locales.map((locale) => [locale, observations[channel].routes[locale].size]),
        ),
      ]),
    ),
    reviewedVariants: variantsByChannel[baseline.channels[0]] ?? [],
    reviewedSourceOnlyRoutes: baseline.reviewedSourceOnlyRoutes,
    reviewedGeneratedRoutes: baseline.reviewedGeneratedRoutes,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'docs-root': { type: 'string', default: 'content/docs' },
      out: { type: 'string', default: 'out' },
      json: { type: 'boolean', default: false },
    },
  });
  const report = await inspectReleaseShape({
    docsRoot: resolve(repoRoot, values['docs-root']),
    outDir: resolve(repoRoot, values.out),
  });
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else {
    for (const [channel, locales] of Object.entries(report.channels)) {
      console.log(`${channel}: ${Object.entries(locales).map(([locale, count]) => `${locale}=${count}`).join(', ')}`);
    }
    console.log(`source routes per locale/channel: ${JSON.stringify(report.baseline.sourceRoutesPerLocaleChannel)}`);
    console.log(`reviewed locale variants: ${report.reviewedVariants.length}`);
    console.log('release-quality-shape: route parity OK.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
