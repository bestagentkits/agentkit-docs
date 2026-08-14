# Impact map contract

Classify every reviewed page family as one of:

- `no-change`: existing meaning remains correct;
- `update`: an existing human-owned Beta page must change;
- `new`: a user-facing concept lacks a route and route-shape work is required;
- `remove`: a published claim or route is obsolete and needs explicit review;
- `mirror`: meaning must stay aligned across EN/VI or related Kit pages;
- `blocked`: evidence is missing, conflicting, or outside current authority.

For each impacted family, record claim IDs, exact existing paths, reason,
required meaning, evidence anchors, locale obligations, and validation. Keep
`new` and `remove` outside V1's modify-only batch until route-shape and promotion
ownership are approved separately.

The approval request must contain only confirmed claim IDs and exact existing
human-owned Beta paths. A no-impact result is a successful no-op. Any unresolved
claim blocks only the paths that depend on it.

When source evidence has an actionable claim but no exact docs route, manual
review may supply a JSON array of existing Beta prose or human-owned metadata
through `--owner-paths`. V0 records the normalized entries in both `paths` and
`ownerDirectedPaths`, and binds the complete final `paths` set into the request
ID and digest. Validation re-derives that set as source-derived impact paths
union owner-directed paths. It does not rewrite the impact map: the pathless
entry stays `blocked` with its original reason so owner direction cannot be
mistaken for source-derived routing.

Owner-directed paths are Beta-only, modify-only, and locale-paired. Allow exact
existing nested CLI prose/metadata under `content/docs/beta/reference/cli/`, but
reject other `reference/` content, Stable/generated paths, missing files,
symlinks, empty/non-array input, single-locale scope, and any scope when the
ledger has no actionable release claim.

