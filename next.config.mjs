import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  // Static export → Cloudflare Pages. No server runtime; all routes prerender.
  output: 'export',
  reactStrictMode: true,
  // Required by `output: 'export'` — the static build cannot use the Image
  // Optimization server.
  images: { unoptimized: true },
  // Pin the workspace root: a stray lockfile in $HOME otherwise makes Next
  // infer the wrong root and warn on every build.
  turbopack: { root: import.meta.dirname },
};

export default withMDX(config);
