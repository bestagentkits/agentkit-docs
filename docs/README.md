# Maintainer documentation

Internal docs for the **ak-docs** repo — not published on the site. For
user-facing content see `content/docs/`.

## Workflow diagrams

| Doc | What it covers |
| --- | --- |
| [CLI reference pipeline](./workflows/cli-reference-pipeline.md) | Three-layer reference model, JSON → prose → derived MDX, CI checks |
| [CLI reference i18n (Vietnamese)](./workflows/cli-reference-i18n.md) | **Proposal:** full VI translation of the derived reference with source-fingerprinted anti-drift guards |
| [Release sync & deploy](./workflows/release-and-deploy.md) | `docs-bundle` ingestion, beta/stable promotion, deploy, docs agent |

## Related

- [`README.md`](../README.md) — runbook, scripts, secrets
- [`reference-prose/README.md`](../reference-prose/README.md) — overlay authoring contract
- [`reference-prose-json/README.md`](../reference-prose-json/README.md) — JSON wire format for agents
- [`AGENTS.md`](../AGENTS.md) — contributor and agent governance
