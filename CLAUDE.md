# CLAUDE.md

Guidance for Claude Code working in **ak-docs** — the documentation site for
AgentKit (`ak`), built with Fumadocs (Next.js, static export) and deployed to
Cloudflare Workers.

Start with [`AGENTS.md`](./AGENTS.md) for dev commands, CI, deploy targets, and
the static-export constraint. This file only records the sibling source repos
this documentation describes; it does not override any global or repo rule.

## Related source repositories

Checked out as siblings of this repo (paths relative to the repo root):

| Purpose | Relative path | GitHub | Notes |
| --- | --- | --- | --- |
| AgentKit (`ak` CLI + Desktop app) | `../agentkit` | https://github.com/bestagentkits/agentkit | The product this site documents. Desktop screenshots in `public/gui/` come from its builds. |
| AgentKit website | `../claudekit-web` | https://github.com/bestagentkits/ak-web | Marketing site at https://agentkit.best (separate from these docs). |

## Docs-specific pointers

- Desktop-app usage docs live under `content/docs/<channel>/desktop-app/`
  (channels: `beta`, `stable`), duplicated per locale as `*.en.mdx` / `*.vi.mdx`.
- Screenshots for those pages live in `public/gui/`; see
  [`public/gui/README.md`](./public/gui/README.md) for the capture and
  optimization manifest.
- `stable` is machine-generated from `beta` by the promotion pipeline, so keep
  new docs channel-neutral (relative links only) and keep the two channels
  byte-identical for any page authored in both.
