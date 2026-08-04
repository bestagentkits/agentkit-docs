# Validation and handoff

Use the smallest checks while authoring, then expand based on risk:

1. `git diff --check`
2. focused Node tests for changed release scripts
3. `pnpm lint` and `pnpm typecheck` for MDX or component changes
4. `pnpm check:catalog`, `pnpm check:reference`, and `pnpm check:quality`
5. `pnpm check:links` and `pnpm build` before integration
6. local EN/VI Beta browser smoke for every changed page family

Do not claim Stable or production completion from a Beta preview. Keep the local
server available when the owner is actively reviewing it.

Return:

- exact from/to tags and commits plus provenance type;
- request ID, request digest, approval mode, approval nonce, and docs base SHA;
- claim IDs covered and unresolved evidence;
- exact changed paths and unchanged protected scopes;
- commands run with pass/fail results;
- local preview routes, PR, CI, staging, and promotion status;
- one next action for every remaining blocker.

