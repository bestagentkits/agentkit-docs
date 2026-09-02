import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { channelFromSlug, type ChannelId } from './channels';
import { parseVariant, resolveVariant } from './route-variant.mjs';

/**
 * Which real content file backs `(slug, locale)`, mirroring the
 * native / shared-default / english-fallback / shared-fallback vocabulary
 * already reviewed in `scripts/release-quality-shape.mjs`
 * (`RELEASE_SHAPE_BASELINE.reviewedVariants`). `null` means the route has no
 * authored MDX at all (e.g. a generated redirect target).
 */
export type RouteVariant =
  | 'native'
  | 'shared-default'
  | 'english-fallback'
  | 'shared-fallback'
  | null;

const contentDocsDir = join(process.cwd(), 'content', 'docs');
const channelVariantCache = new Map<ChannelId, Map<string, Set<string>>>();

function collectMdxPaths(dir: string, root: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMdxPaths(full, root, files);
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      files.push(full.slice(root.length + 1).split(sep).join('/'));
    }
  }
  return files;
}

function variantsByRoute(channel: ChannelId): Map<string, Set<string>> {
  const cached = channelVariantCache.get(channel);
  if (cached) return cached;

  const map = new Map<string, Set<string>>();
  const channelDir = join(contentDocsDir, channel);
  for (const path of collectMdxPaths(channelDir, channelDir)) {
    const { route, variant } = parseVariant(path);
    const variants = map.get(route) ?? new Set<string>();
    variants.add(variant);
    map.set(route, variants);
  }
  channelVariantCache.set(channel, map);
  return map;
}

/** `slug` is channel-inclusive (`['stable', 'guides', 'foo']`), as returned by `page.slugs`. */
export function resolveRouteVariant(slug: string[], locale: string): RouteVariant {
  const channel = channelFromSlug(slug);
  if (!channel) return null;

  const route = slug.slice(1).join('/');
  const variants = variantsByRoute(channel).get(route);
  if (!variants) return null;

  return resolveVariant(variants, locale) as RouteVariant;
}

/** Whether `locale` has real, locale-authored content at `slug` (not a silent `fallbackLanguage` copy). */
export function isCanonicalContent(slug: string[], locale: string): boolean {
  const variant = resolveRouteVariant(slug, locale);
  return variant === 'native' || (locale === 'en' && variant === 'shared-default');
}

/** Subset of `languages` that have real content at `slug` — for hreflang, never a fallback locale. */
export function contentLocales(slug: string[], languages: readonly string[]): string[] {
  return languages.filter((lang) => isCanonicalContent(slug, lang));
}
