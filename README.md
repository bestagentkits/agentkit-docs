# ak-docs

Official documentation site for the **AgentKit** (`ak`) CLI — [docs.agentkit.best](https://docs.agentkit.best) *(domain pending)*.

Built with [Fumadocs](https://fumadocs.dev) (Next.js, **static export**) and deployed to **Cloudflare Pages** ($0 hosting, no server runtime). The site tracks two release channels — **stable** and **beta** — and keeps the CLI reference in sync with released binaries via an automated pipeline. The design system reuses the real agentkit.best brand tokens (dark-first canvas, steel-blue accent, Instrument Serif + Geist).

## Local development

```bash
pnpm install
pnpm dev            # dev server at http://localhost:3000
pnpm build          # static export → ./out
pnpm typecheck      # fumadocs-mdx + next typegen + tsc --noEmit
npx serve out       # serve the static build locally
```

Requires Node ≥ 20.9 (see `.nvmrc` → 22) and pnpm (see `packageManager` in `package.json`).

## Project layout

```
app/            Next.js App Router — docs layout, home, static route handlers
content/docs/   MDX content (channel/locale structure added in a later phase)
lib/            Fumadocs source adapter + shared layout config
components/     MDX components, search dialog, providers
next.config.mjs output: 'export' (static), images unoptimized, turbopack root pinned
source.config.ts  fumadocs-mdx collections + frontmatter schema
```

The build is 100% static: `pnpm build` emits `out/` with no `.next/server` runtime.
Client-side search uses a build-time Orama index (`/api/search` prerenders to a static asset).

## Deployment — Cloudflare Pages

Deployed via Cloudflare Pages **Git integration** (gives production + per-PR preview deploys for free). Console setup (not reproducible from code — recorded here):

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → select this repo.
2. Build settings:
   - **Framework preset:** None
   - **Build command:** `pnpm build`
   - **Build output directory:** `out`
   - **Environment variable:** `NODE_VERSION = 22`
3. Enable **preview deployments** for pull requests (default on).
4. (Later, once the domain is confirmed) add the custom domain `docs.agentkit.best` + DNS.

`wrangler pages deploy out` is the documented fallback if the org later wants workflow-controlled deploys instead of Git integration.

## CI

`.github/workflows/ci.yml` runs on every PR and push to `main`: install (frozen lockfile) → typecheck → build. Later phases extend it with link checking, lint, and generated-directory guards.
