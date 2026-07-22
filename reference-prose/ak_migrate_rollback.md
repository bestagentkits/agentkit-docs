Roll back a failed migration to its pre-apply state using the most recent rollback journal from the failed apply.

**When to use it:** After `ak migrate --dry-run=false` failed or produced an unwanted result.

Restores files from the rollback journal and removes the journal on success.
