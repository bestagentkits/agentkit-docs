# Maintainer documentation

Internal docs for the **ak-docs** repo — not published on the site. For
user-facing content see `content/docs/`.

## Workflow diagrams

| Doc | What it covers |
| --- | --- |
| [CLI reference pipeline](./workflows/cli-reference-pipeline.md) | Three-layer reference model, JSON → prose → derived MDX, CI checks |
| [CLI reference i18n (Vietnamese)](./workflows/cli-reference-i18n.md) | **Proposal:** full VI translation of the derived reference with source-fingerprinted anti-drift guards |
| [Release maintenance & deploy](./workflows/release-and-deploy.md) | Skill-first release audit, reviewed channel updates, deploy, CI |
| [Post-launch quality & operations](./workflows/post-launch-operations.md) | Route/search/output baselines, browser matrix, promotion evidence, exact rollback and cleanup |
| [SEO indexing policy](./workflows/seo-indexing-policy.md) | sitemap.xml/robots.txt generation, stable-vs-beta and locale-fallback indexing decisions |

## Related

- [`README.md`](../README.md) — runbook, scripts, secrets
- [`reference-prose/README.md`](../reference-prose/README.md) — overlay authoring contract
- [`reference-prose-json/README.md`](../reference-prose-json/README.md) — JSON wire format for agents
- [`AGENTS.md`](../AGENTS.md) — contributor and agent governance
