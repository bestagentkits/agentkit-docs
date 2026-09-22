# CLI reference ownership and release workflow

Published command documentation is human-owned. A release help projection is
separate evidence and must not overwrite published pages.

| Path | Owner | Role |
| --- | --- | --- |
| `reference-raw/` | Release sync | Exact CLI help input, scrubbed for public links |
| `reference-prose-json/` and `reference-prose/` | Reviewed overlay | Optional narrative used by the help projection |
| `reference-derived/` | Generator | Non-published reproducible help projection |
| `content/docs/beta/reference/cli/` | Reviewed authoring | Nested EN/VI public routes and navigation |
| `content/docs/stable/reference/cli/` | Promotion | Exact release-matched Beta snapshot, bound by receipt |

## Update a command

1. Read the exact release help and implementing source/tests for behavior the
   help omits. Inspect source diffs even when help is unchanged.
2. Sync the bundle with `scripts/sync-release.mjs`. Update overlays only when
   their content is affected; run `scripts/compile-prose.mjs --check` and
   `scripts/generate-reference.mjs` to prove the projection is reproducible.
3. Map each changed or uncovered command to its public route. Add, modify or
   retire the EN/VI pair and matching navigation under the approved scope.
   Keep command syntax, flags and enum values unchanged in translations.
4. Check published examples and relative links, then build and check route
   shape, Markdown exports and search discovery. A zero generator diff does not
   prove this public documentation step is complete.
5. Promote Stable only from its release-matched historical Beta snapshot, never
   from a newer current Beta tree merely to satisfy route parity.

Legacy optional docs-agent automation has its own narrow scope. The local
manual release authoring contract and action scope are described in the
[release runbook](release-and-deploy.md).
