import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkLint from 'remark-lint';
import remarkLintNoUndefinedReferences from 'remark-lint-no-undefined-references';

// MDX content lint. The parse plugins let remark read our frontmatter + GFM
// tables + MDX/JSX without choking; `--frail` then fails CI on any lint message.
// Kept intentionally light — the build already rejects unparseable MDX, so this
// layer catches the subtler markdown issues (e.g. dangling reference links).
export default {
  plugins: [
    remarkFrontmatter,
    remarkGfm,
    remarkMdx,
    remarkLint,
    // Bracketed text like `[flags]` in prose is not a reference link; allow it.
    [remarkLintNoUndefinedReferences, { allowShortcutLink: true }],
  ],
};
