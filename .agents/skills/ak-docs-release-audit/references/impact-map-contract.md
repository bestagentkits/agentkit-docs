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

