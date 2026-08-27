# Validation and handoff

Use the smallest checks while authoring, then expand based on risk:

1. `git diff --check`
2. focused Node tests for changed release scripts
3. `pnpm lint` and `pnpm typecheck` for MDX or component changes
4. `pnpm check:catalog`, `pnpm check:reference`, and `pnpm check:quality`
5. `pnpm check:links` and `pnpm build` before integration
6. local EN/VI Beta browser smoke for every changed page family

For Kit-sensitive release or promotion work, also require:

1. exact Beta and Stable `(kitId, runtime)` artifact inventories for
   `claude-code`, `codex`, `cursor`, `grok`, `omp`, and `pi`;
2. manifest, archive, `.sha256` sidecar, and release-page digest agreement for
   every inventory key;
3. artifact-hash comparison before interpreting tag or version deltas;
4. per-channel Kit-tree inventory, body/support-file drift result, and
   cross-page Kit-claim scan; and
5. exact Kit-doc closure equality when the complete artifact matrices are
   equal.

Any incomplete matrix or equal-artifact closure mismatch blocks `dev` → `main`.
Do not claim Stable or production completion from a Beta preview. Keep the local
server available when the owner is actively reviewing it.

Return:

- exact from/to tags and commits plus provenance type;
- request ID, request digest, approval mode, approval nonce, and docs base SHA;
- claim IDs covered and unresolved evidence;
- exact changed paths and unchanged protected scopes;
- commands run with pass/fail results;
- local preview routes, PR, CI, staging, and promotion status;
- one next action for every remaining blocker; and
- separate **Beta** and **Stable** status rows containing bound tag/SHA,
  manifest-set digest, exact expected and observed artifact inventory, sidecar
  result, matrix digest, Kit-tree inventory/closure result, body/support-file
  drift, cross-page claim scan, blockers, and reconciliation status.

After the channel rows, state the matrix relation, closure relation, and explicit
`dev` → `main` decision. For reconciliation, include the manifest and matrix
digests, Beta source blob hashes, Stable preimage blob hashes, exact allowlist,
resulting blob hashes, and proof that no unrelated path changed.
