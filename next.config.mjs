import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  // Static export → Cloudflare Workers (static assets). No server runtime; all routes prerender.
  output: 'export',
  reactStrictMode: true,
  // Allow the shared local-review URL to connect to Next.js development HMR.
  allowedDevOrigins: ['127.0.0.1'],
  // Required by `output: 'export'` — the static build cannot use the Image
  // Optimization server.
  images: { unoptimized: true },
  // Pin the workspace root: a stray lockfile in $HOME otherwise makes Next
  // infer the wrong root and warn on every build.
  turbopack: { root: import.meta.dirname },
};

export default withMDX(config);
