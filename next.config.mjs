import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();
const isProd = process.env.NODE_ENV === 'production';

/** @type {import('next').NextConfig} */
const config = {
  // Static export only for production builds. Keeping it enabled in `next dev`
  // breaks prefixless en routes (/beta/…) — they match [lang]=beta and 500.
  ...(isProd ? { output: 'export' } : {}),
  reactStrictMode: true,
  // Required by `output: 'export'` — the static build cannot use the Image
  // Optimization server.
  images: { unoptimized: true },
  // Pin the workspace root: a stray lockfile in $HOME otherwise makes Next
  // infer the wrong root and warn on every build.
  turbopack: { root: import.meta.dirname },
  // Dev parity with public/_redirects (middleware is unavailable with export).
  async rewrites() {
    if (isProd) return [];
    return {
      beforeFiles: [
        { source: '/stable/:path*', destination: '/en/stable/:path*' },
        { source: '/beta/:path*', destination: '/en/beta/:path*' },
        { source: '/_showcase', destination: '/en/_showcase' },
      ],
    };
  },
};

export default withMDX(config);
