# Kit prose drift

Bundle contract v1 does not carry `content/docs/<channel>/kits/**/skills/*.mdx`;
V0 has no evidence to bind those pages. Frontmatter-only detection (from the
Kits blind-spot bullet in `SKILL.md`) catches identity changes
(`user-invocable`, `disable-model-invocation`, `name`, `keywords`), but misses
prose drift in existing skill pages when the skill body, `.env.example`, or
`skill.yaml` runtime block change while identity stays stable.

Real example: `v2.12.1-beta.6` moved `ak-ai-multimodal` from
`@mrgoonie/multix@0.2.0` pinned to `@latest`. Frontmatter unchanged; body,
`.env.example` comment, and `skill.yaml` runtime pin all changed. The
identity-only detector reported no-op, so `ak-ai-multimodal.{en,vi}.mdx` and
5 cross-referencing kit pages kept advertising the removed pin. Detection
must complement identity checks with a body-diff pass.

## Detection

Runs whenever a Kits blind-spot pass runs, in addition to the identity
comparison already documented in `SKILL.md`.

1. Diff each `agentkit-kit-<kit>-<runtime>-<from-tag>.tar.gz` against its
   `<to-tag>` counterpart. Group by `skills/<slug>/`.
2. For each slug with any of `SKILL.md`, `skill.yaml`, or `.env.example`
   differing, extract per-file text fingerprints from the `to` side:
   - Backtick-fenced tokens (`` `@mrgoonie/multix@0.2.0` ``,
     `` `journal.auto` ``, `` `ak config` ``).
   - Version pin patterns (`@<name>@<semver>`, `<pkg>==<pin>`,
     `pin <ver>`).
   - Distinctive prose phrases (5+ word runs unique to the changed body).
3. Do the same on the `from` side. The evidence set is the symmetric
   difference — tokens/phrases that appear in one side but not the other.
4. For each drifted slug, phrase-grep the evidence set across the
   channel's kit pages under `content/docs/<channel>/kits/**/skills/*.mdx`
   (both EN + VI, both `engineer/` and `marketing/` where the slug ships).
5. A page is a candidate when it matches any `from`-only token or phrase
   (i.e., the docs still advertise the retired form).

Only the beta channel scans on a beta sync. Stable stays bound to
`channels.stable.tag`; it will be refreshed on the next stable promote or
its own beta sync.

## Threshold gates

- **Slug gate**: skip when 0 slugs drift.
- **Page gate**: report candidates individually — no aggregate minimum.
  Prose drift is rare and low-noise; a single stale page is worth
  surfacing.
- **Breaking override**: not applicable; kit tars do not carry a
  breaking marker.

## Owner prompt

```text
Kit prose drift candidates from <from-ref> → <to-ref>:

  ak-ai-multimodal (engineer + marketing):
    - kits/engineer/skills/ai-multimodal.{en,vi}.mdx — @0.2.0 pin (14 hits)
    - kits/marketing/skills/ai-multimodal.{en,vi}.mdx — @0.2.0 pin (7 hits)
    - kits/engineer/skills/ai-artist.{en,vi}.mdx — @0.2.0 cross-ref (2 hits)
    …

Compile refresh under owner-directed scope?

Reply:
  approve REQ-<id> paths <list>   — refresh subset
  approve REQ-<id> all             — refresh every candidate
  skip                             — defer to a follow-up PR
```

Owner reply is appended to the V0 approval-request as evidence
alongside any CLI prose approval.

## Authoring rules

- EN + VI parity. Technical tokens (`ak config`, `@mrgoonie/multix`,
  `npx --package=`) must stay identical across locales.
- Do not invent claims beyond what the new SKILL.md body, `.env.example`,
  or `skill.yaml` supports. When new prose introduces a token, cite it
  by its exact form.
- Preserve untouched sections. Prose drift edits are token-scoped
  replacements plus small phrase rewrites, not full-page rewrites.
- When the `from` form remains valid in the `stable/` mirror (bound to
  an older tag), do not mirror the change into `content/docs/stable/**`.
  Wait for the next stable promote.

## Post-refresh validation

- `pnpm lint` on the changed files.
- `pnpm check:catalog` — kit identity totals unchanged.
- `pnpm check:reference` — reference hygiene clean.
- `pnpm check:links` on the built output — no broken cross-refs after
  version-token substitution.
- Local beta smoke of one refreshed route via `pnpm exec serve out`.

## Fall-through

When no slug drifts, log `kit-prose-drift: no candidates` in the PR body
so future runs can distinguish "checked, none found" from "not run".
