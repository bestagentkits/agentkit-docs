import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';

// You can customize Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid],
    // Code blocks stay dark in both light and dark mode (developer expectation;
    // matches the agentkit.best brand guideline §3.3). Using one dark Shiki
    // theme for both keeps syntax colors AA-legible on the dark code surface.
    rehypeCodeOptions: {
      themes: {
        light: 'github-dark',
        dark: 'github-dark',
      },
    },
  },
});
