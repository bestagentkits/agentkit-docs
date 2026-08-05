#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const PREFLIGHT_SCHEMA_VERSION = 1;

export const REQUIRED = Object.freeze({
  secrets: [
    'AK_CLI_READ_TOKEN',
    'ANTHROPIC_API_KEY',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'DOCS_AGENT_APP_ID',
    'DOCS_AGENT_PRIVATE_KEY',
    'DOCS_BOT_APP_ID',
    'DOCS_BOT_PRIVATE_KEY',
  ],
  variables: ['AK_CLI_REPO'],
  labels: ['docs-agent', 'docs-promotion'],
  apps: ['agentkit-docs-bot', 'agentkit-docs-agent'],
  checks: ['build', 'guard'],
  workflows: ['docs-sync.yml', 'docs-agent.yml', 'agent-guard.yml'],
  upstreamSecret: 'AK_DOCS_DISPATCH_TOKEN',
});

const SENSITIVE_KEY = /^(?:authorization|credentials?|password|private[_-]?key|secrets?|secret[_-]?value|(?:access|auth|refresh)?[_-]?token|value)$/i;
const SENSITIVE_TEXT = /(?:gh[opusr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~-]{12,})/g;

export function redactSensitive(input) {
  if (Array.isArray(input)) return input.map(redactSensitive);
  if (input && typeof input === 'object') {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(value),
    ]));
  }
  return typeof input === 'string' ? input.replace(SENSITIVE_TEXT, '[REDACTED]') : input;
}

function api(args, { allowMissing = false } = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status === 0) {
    try {
      return { observable: true, value: JSON.parse(result.stdout || 'null') };
    } catch {
      return { observable: false, reason: 'invalid JSON returned by GitHub CLI' };
    }
  }
  const status = Number(result.stderr.match(/HTTP (\d{3})/)?.[1] ?? 0);
  if (allowMissing && status === 404) return { observable: true, value: null };
  return {
    observable: false,
    reason: status ? `GitHub API returned HTTP ${status}` : 'GitHub CLI request failed',
  };
}

function ghApi(path, options = {}) {
  return api(['api', '-H', 'Accept: application/vnd.github+json', path], options);
}

function ghList(args) {
  return api(args);
}

function names(result) {
  return result.observable && Array.isArray(result.value)
    ? result.value.map((entry) => entry.name).filter(Boolean)
    : null;
}

function contentAt(repository, path, ref) {
  const result = ghApi(`repos/${repository}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
    allowMissing: true,
  });
  if (!result.observable || result.value === null) return { ...result, text: null };
  try {
    return {
      observable: true,
      value: result.value,
      text: Buffer.from(result.value.content, 'base64').toString('utf8'),
    };
  } catch {
    return { observable: false, reason: `could not decode ${path}`, text: null };
  }
}

function refMatches(rule, branch, defaultBranch) {
  const include = rule.conditions?.ref_name?.include ?? [];
  const exclude = rule.conditions?.ref_name?.exclude ?? [];
  const ref = `refs/heads/${branch}`;
  const matches = (pattern) => pattern === ref ||
    (pattern === '~DEFAULT_BRANCH' && branch === defaultBranch) ||
    (pattern.endsWith('*') && ref.startsWith(pattern.slice(0, -1)));
  return (include.length === 0 || include.some(matches)) && !exclude.some(matches);
}

function normalizeBranchPolicy(branch, defaultBranch, rulesets, classicProtection, appsById) {
  const applicable = (rulesets ?? []).filter((ruleset) =>
    ruleset.enforcement === 'active' &&
    ruleset.target === 'branch' &&
    refMatches(ruleset, branch, defaultBranch));
  const rules = applicable.flatMap((ruleset) => ruleset.rules ?? []);
  const pullRequest = rules.find((rule) => rule.type === 'pull_request')?.parameters;
  const requiredStatus = rules.find((rule) => rule.type === 'required_status_checks')?.parameters;
  const rulesetBypass = applicable.flatMap((ruleset) => ruleset.bypass_actors ?? []).map((actor) => ({
    type: actor.actor_type,
    login: appsById.get(actor.actor_id) ?? null,
    actorId: actor.actor_id,
    mode: actor.bypass_mode,
  }));

  const classicChecks = classicProtection?.required_status_checks?.checks?.map((check) => check.context) ??
    classicProtection?.required_status_checks?.contexts ?? [];
  const classicReview = classicProtection?.required_pull_request_reviews;
  const classicBypass = [
    ...(classicProtection?.restrictions?.apps ?? []).map((app) => ({ type: 'Integration', login: app.slug, mode: 'always' })),
    ...(classicProtection?.restrictions?.teams ?? []).map((team) => ({ type: 'Team', login: team.slug, mode: 'always' })),
    ...(classicProtection?.restrictions?.users ?? []).map((user) => ({ type: 'User', login: user.login, mode: 'always' })),
  ];

  return {
    active: applicable.length > 0 || Boolean(classicProtection),
    sources: [
      ...applicable.map((ruleset) => `ruleset:${ruleset.name}`),
      ...(classicProtection ? ['branch-protection'] : []),
    ],
    requirePullRequest: Boolean(pullRequest || classicReview),
    requiredApprovingReviewCount: Math.max(
      pullRequest?.required_approving_review_count ?? 0,
      classicReview?.required_approving_review_count ?? 0,
    ),
    requireCodeOwnerReview: Boolean(
      pullRequest?.require_code_owner_review || classicReview?.require_code_owner_reviews,
    ),
    dismissStaleReviews: Boolean(
      pullRequest?.dismiss_stale_reviews_on_push || classicReview?.dismiss_stale_reviews,
    ),
    requiredChecks: [...new Set([
      ...(requiredStatus?.required_status_checks ?? []).map((check) => check.context),
      ...classicChecks,
    ])],
    bypassActors: [...rulesetBypass, ...classicBypass],
    blocksForcePushes: rules.some((rule) => rule.type === 'non_fast_forward') ||
      classicProtection?.allow_force_pushes?.enabled === false,
    blocksDeletions: rules.some((rule) => rule.type === 'deletion') ||
      classicProtection?.allow_deletions?.enabled === false,
  };
}

function workflowState(repository, workflow) {
  const definition = ghApi(`repos/${repository}/actions/workflows/${workflow}`, { allowMissing: true });
  const runs = ghApi(`repos/${repository}/actions/workflows/${workflow}/runs?per_page=30`, {
    allowMissing: true,
  });
  return {
    observable: definition.observable && runs.observable,
    state: definition.value?.state ?? null,
    runs: runs.value?.workflow_runs?.map((run) => ({
      id: run.id,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      headBranch: run.head_branch,
      headSha: run.head_sha,
      createdAt: run.created_at,
      url: run.html_url,
    })) ?? [],
  };
}

function branchPolicy(repository, branch, defaultBranch, rulesets, appsById) {
  const classic = ghApi(`repos/${repository}/branches/${branch}/protection`, { allowMissing: true });
  if (!classic.observable) return { observable: false, reason: classic.reason };
  return {
    observable: true,
    ...normalizeBranchPolicy(branch, defaultBranch, rulesets, classic.value, appsById),
  };
}

function appState(org, slug) {
  const identity = ghApi(`apps/${slug}`, { allowMissing: true });
  const installations = ghApi(`orgs/${org}/installations`, { allowMissing: true });
  const app = identity.value;
  const installation = installations.value?.installations?.find((item) => item.app_slug === slug);
  return {
    identityObservable: identity.observable,
    exists: Boolean(app),
    id: app?.id ?? null,
    login: app?.slug ?? null,
    installationObservable: installations.observable,
    installed: installations.observable ? Boolean(installation) : null,
    suspended: installation?.suspended_at != null,
  };
}

function environments(repository) {
  const result = ghApi(`repos/${repository}/environments?per_page=100`);
  if (!result.observable) return { observable: false, items: {} };
  return {
    observable: true,
    items: Object.fromEntries((result.value.environments ?? []).map((environment) => [
      environment.name,
      {
        exists: true,
        protectionRules: environment.protection_rules ?? [],
        branchPolicy: environment.deployment_branch_policy,
      },
    ])),
  };
}

function releaseEvidence(repository) {
  const result = ghApi(`repos/${repository}/releases?per_page=30`);
  if (!result.observable) return { observable: false, releases: [] };
  return {
    observable: true,
    releases: result.value.map((release) => ({
      tag: release.tag_name,
      target: release.target_commitish,
      draft: release.draft,
      prerelease: release.prerelease,
      publishedAt: release.published_at,
      assets: release.assets.map((asset) => asset.name),
    })),
  };
}

export function collectLiveState({
  repository = 'bestagentkits/agentkit-docs',
  upstreamRepository = 'bestagentkits/agentkit',
  upstreamRef = 'dev',
  repoRoot = process.cwd(),
  now = new Date().toISOString(),
} = {}) {
  const org = repository.split('/')[0];
  const repo = ghApi(`repos/${repository}`);
  if (!repo.observable) throw new Error(`cannot inspect ${repository}: ${repo.reason}`);

  const apps = Object.fromEntries(REQUIRED.apps.map((slug) => [slug, appState(org, slug)]));
  const appsById = new Map(Object.entries(apps).filter(([, app]) => app.id).map(([slug, app]) => [app.id, slug]));
  const rulesetList = ghApi(`repos/${repository}/rulesets?includes_parents=true`);
  const rulesets = rulesetList.observable
    ? rulesetList.value.map((item) => ghApi(`repos/${repository}/rulesets/${item.id}?includes_parents=true`))
      .filter((item) => item.observable).map((item) => item.value)
    : null;
  const codeowners = ghApi(`repos/${repository}/codeowners/errors`);
  const localCodeowners = readFileSync(resolve(repoRoot, '.github/CODEOWNERS'), 'utf8');
  const ownerLogins = [...new Set([...localCodeowners.matchAll(/@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+/g)].map((match) => match[0]))];

  const secretNames = ghList(['secret', 'list', '--repo', repository, '--json', 'name']);
  const variableNames = ghList(['variable', 'list', '--repo', repository, '--json', 'name']);
  const labels = ghApi(`repos/${repository}/labels?per_page=100`);
  const envs = environments(repository);
  const tags = ghApi(`repos/${repository}/tags?per_page=100`);
  const ci = workflowState(repository, 'ci.yml');
  const docsWorkflows = Object.fromEntries(REQUIRED.workflows.map((name) => [name, workflowState(repository, name)]));
  const guardWorkflow = contentAt(repository, '.github/workflows/agent-guard.yml', 'dev');

  const upstreamSecretNames = ghList(['secret', 'list', '--repo', upstreamRepository, '--json', 'name']);
  const generator = contentAt(upstreamRepository, 'apps/cli/cmd/gen-docs/main.go', upstreamRef);
  const upstreamWorkflowFiles = ['release-kits.yml', 'release.yml', 'auto-semver-release.yml'];
  const workflowText = upstreamWorkflowFiles.map((name) =>
    contentAt(upstreamRepository, `.github/workflows/${name}`, upstreamRef)).map((item) => item.text ?? '').join('\n');
  const releases = releaseEvidence(upstreamRepository);
  const upstreamRuns = upstreamWorkflowFiles.map((name) => workflowState(upstreamRepository, name));

  return {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    observedAt: now,
    docs: {
      repository,
      secretNames: names(secretNames),
      variableNames: names(variableNames),
      labelNames: labels.observable ? labels.value.map((label) => label.name) : null,
      apps,
      codeowners: {
        observable: codeowners.observable,
        owners: ownerLogins,
        errors: codeowners.value?.errors ?? null,
      },
      branches: {
        dev: branchPolicy(repository, 'dev', repo.value.default_branch, rulesets, appsById),
        main: branchPolicy(repository, 'main', repo.value.default_branch, rulesets, appsById),
      },
      environments: envs,
      workflows: docsWorkflows,
      guardContract: {
        observable: guardWorkflow.observable && guardWorkflow.text !== null,
        labelTriggerPresent: /contains\([^\n]*labels[^\n]*['"]docs-agent['"]\)/.test(guardWorkflow.text ?? ''),
        authorTriggerLogin: guardWorkflow.text?.match(/pull_request\.user\.login\s*==\s*['"]([^'"]+)['"]/)?.[1] ?? null,
      },
      ci,
      tags: tags.observable ? tags.value.map((tag) => tag.name) : null,
    },
    upstream: {
      repository: upstreamRepository,
      ref: upstreamRef,
      secretNames: names(upstreamSecretNames),
      producer: {
        observable: generator.observable && workflowText.length > 0,
        generatorPresent: Boolean(generator.value),
        bundleUploadPresent: /docs-bundle\.tar\.gz/.test(workflowText) && /gh release upload/.test(workflowText),
        checksumOrProvenancePresent: /docs-bundle\.tar\.gz\.(?:sha256|intoto\.jsonl)/.test(workflowText) ||
          /docs-bundle[^\n]*(?:provenance|attestation)/i.test(workflowText),
        dispatchPresent: /release-docs/.test(workflowText) && /\/dispatches/.test(workflowText),
      },
      releases,
      workflows: upstreamRuns,
    },
  };
}

function add(checks, id, status, message) {
  checks.push({ id, status, message });
}

function checkNames(checks, id, actual, required, noun) {
  if (!actual) return add(checks, id, 'unknown', `${noun} names were not observable`);
  const missing = required.filter((name) => !actual.includes(name));
  add(checks, id, missing.length ? 'fail' : 'pass', missing.length
    ? `missing ${noun}: ${missing.join(', ')}`
    : `all ${required.length} required ${noun} names exist (values not requested)`);
}

function checkBranch(checks, branch, policy) {
  const id = `branch-${branch}`;
  if (!policy?.observable) return add(checks, id, 'unknown', `${branch} protection was not observable`);
  const failures = [];
  if (!policy.active) failures.push('no active ruleset or branch protection');
  if (!policy.requirePullRequest) failures.push('pull requests are not required');
  if (policy.requiredApprovingReviewCount < 1) failures.push('no approving review is required');
  if (!policy.requireCodeOwnerReview) failures.push('CODEOWNERS review is not required');
  if (!policy.dismissStaleReviews) failures.push('stale approvals are not dismissed');
  for (const required of REQUIRED.checks) {
    if (!policy.requiredChecks.includes(required)) failures.push(`required check ${required} is absent`);
  }
  if (!policy.blocksForcePushes) failures.push('force pushes are not blocked');
  if (!policy.blocksDeletions) failures.push('branch deletion is not blocked');

  const bypass = policy.bypassActors ?? [];
  if (branch === 'dev') {
    if (bypass.length !== 1 || bypass[0].login !== 'agentkit-docs-bot' ||
        bypass[0].type !== 'Integration' || bypass[0].mode !== 'always') {
      failures.push('dev bypass must contain only the always-mode agentkit-docs-bot Integration');
    }
    if (bypass.some((actor) => actor.login === 'agentkit-docs-agent' || actor.type === 'User')) {
      failures.push('docs-agent or human bypass detected');
    }
  } else if (bypass.length > 0) {
    failures.push('main must have no bypass actors');
  }
  add(checks, id, failures.length ? 'fail' : 'pass', failures.length
    ? failures.join('; ')
    : `${branch} requires reviews, CODEOWNERS, build+guard, and the expected bypass split`);
}

function hasRestrictedBranchPolicy(environment) {
  const policy = environment?.branchPolicy;
  return Boolean(policy && (policy.protected_branches || policy.custom_branch_policies));
}

export function evaluatePreflight(snapshot) {
  const checks = [];
  if (snapshot?.schemaVersion !== PREFLIGHT_SCHEMA_VERSION) {
    add(checks, 'snapshot-schema', 'fail', `expected snapshot schemaVersion ${PREFLIGHT_SCHEMA_VERSION}`);
    return summarize(checks);
  }
  checkNames(checks, 'repo-secrets', snapshot.docs?.secretNames, REQUIRED.secrets, 'secret');
  checkNames(checks, 'repo-variables', snapshot.docs?.variableNames, REQUIRED.variables, 'variable');
  checkNames(checks, 'labels', snapshot.docs?.labelNames, REQUIRED.labels, 'label');

  for (const slug of REQUIRED.apps) {
    const app = snapshot.docs?.apps?.[slug];
    if (!app?.identityObservable || !app.exists || app.login !== slug) {
      add(checks, `app-${slug}`, 'fail', `${slug} login identity does not resolve`);
    } else if (!app.installationObservable) {
      add(checks, `app-${slug}`, 'unknown', `${slug} exists, but installation membership was not observable`);
    } else if (!app.installed || app.suspended) {
      add(checks, `app-${slug}`, 'fail', `${slug} is not actively installed on the docs repository`);
    } else {
      add(checks, `app-${slug}`, 'pass', `${slug} resolves and is actively installed`);
    }
  }

  const codeowners = snapshot.docs?.codeowners;
  if (!codeowners?.observable || codeowners.errors === null) {
    add(checks, 'codeowners', 'unknown', 'CODEOWNERS resolution was not observable');
  } else if (!codeowners.owners?.length || codeowners.errors.length) {
    add(checks, 'codeowners', 'fail', `${codeowners.errors.length} CODEOWNERS resolution error(s)`);
  } else {
    add(checks, 'codeowners', 'pass', `${codeowners.owners.length} CODEOWNERS identity entry/entries resolve`);
  }

  checkBranch(checks, 'dev', snapshot.docs?.branches?.dev);
  checkBranch(checks, 'main', snapshot.docs?.branches?.main);

  const envs = snapshot.docs?.environments;
  if (!envs?.observable) {
    add(checks, 'environments', 'unknown', 'environment protection was not observable');
  } else {
    const staging = envs.items?.staging;
    const production = envs.items?.production;
    const productionReviewers = production?.protectionRules?.some((rule) => rule.type === 'required_reviewers');
    const failures = [];
    if (!staging?.exists || !hasRestrictedBranchPolicy(staging)) failures.push('staging is not branch-restricted');
    if (!production?.exists || !hasRestrictedBranchPolicy(production)) failures.push('production is not branch-restricted');
    if (!productionReviewers) failures.push('production has no required reviewer');
    add(checks, 'environments', failures.length ? 'fail' : 'pass', failures.length
      ? failures.join('; ')
      : 'staging/production are branch-restricted and production requires approval');
  }

  for (const workflow of REQUIRED.workflows) {
    const state = snapshot.docs?.workflows?.[workflow];
    add(checks, `workflow-${workflow}`, state?.observable && state.state === 'active' ? 'pass' : 'fail',
      state?.observable && state.state === 'active' ? `${workflow} is active` : `${workflow} is missing, disabled, or unobservable`);
  }
  const guard = snapshot.docs?.guardContract;
  if (!guard?.observable) {
    add(checks, 'guard-identity', 'unknown', 'agent-guard author condition was not observable');
  } else {
    const ready = guard.labelTriggerPresent && guard.authorTriggerLogin === 'agentkit-docs-agent[bot]';
    add(checks, 'guard-identity', ready ? 'pass' : 'fail', ready
      ? 'guard triggers on the docs-agent label and actual docs-agent bot login'
      : `guard must trigger on docs-agent label and agentkit-docs-agent[bot]; observed ${guard.authorTriggerLogin ?? 'no author login'}`);
  }

  checkNames(checks, 'upstream-secret', snapshot.upstream?.secretNames, [REQUIRED.upstreamSecret], 'upstream secret');
  const producer = snapshot.upstream?.producer;
  const producerMissing = producer ? [
    ['gen-docs source', producer.generatorPresent],
    ['bundle release upload', producer.bundleUploadPresent],
    ['bundle checksum/provenance', producer.checksumOrProvenancePresent],
    ['release-docs dispatch', producer.dispatchPresent],
  ].filter(([, ready]) => !ready).map(([name]) => name) : ['producer metadata'];
  add(checks, 'upstream-producer', producer?.observable && producerMissing.length === 0 ? 'pass' :
    producer?.observable ? 'fail' : 'unknown', producerMissing.length
    ? `missing ${producerMissing.join(', ')}`
    : 'upstream generates, attests, uploads, then dispatches docs-bundle');

  const releases = snapshot.upstream?.releases;
  if (!releases?.observable) {
    add(checks, 'upstream-release-assets', 'unknown', 'upstream releases were not observable');
  } else {
    const beta = releases.releases.find((release) => release.prerelease && /-beta\./.test(release.tag));
    const stable = releases.releases.find((release) => !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag));
    const complete = (release) => release?.assets.includes('docs-bundle.tar.gz') &&
      release.assets.some((name) => name === 'docs-bundle.tar.gz.sha256' || name.includes('docs-bundle') && name.includes('provenance'));
    const missing = [!complete(beta) && 'latest beta', !complete(stable) && 'latest stable'].filter(Boolean);
    add(checks, 'upstream-release-assets', missing.length ? 'fail' : 'pass', missing.length
      ? `${missing.join(' and ')} release evidence lacks bundle plus checksum/provenance`
      : 'latest beta and stable releases contain bundle plus checksum/provenance');
  }

  const syncRuns = snapshot.docs?.workflows?.['docs-sync.yml']?.runs ?? [];
  const successfulDispatches = syncRuns.filter((run) => run.event === 'repository_dispatch' && run.conclusion === 'success');
  const tags = snapshot.docs?.tags;
  if (!tags) {
    add(checks, 'sync-evidence', 'unknown', 'docs tags were not observable');
  } else {
    const hasBetaTag = tags.some((tag) => /^docs\/v\d+\.\d+\.\d+-beta\.\d+$/.test(tag));
    const hasStableTag = tags.some((tag) => /^docs\/v\d+\.\d+\.\d+$/.test(tag));
    const ready = successfulDispatches.length >= 2 && hasBetaTag && hasStableTag;
    add(checks, 'sync-evidence', ready ? 'pass' : 'fail', ready
      ? 'successful dispatch runs and beta/stable docs tags are present'
      : `need two successful dispatch runs plus beta/stable docs tags; found ${successfulDispatches.length} run(s)`);
  }

  const ciRuns = snapshot.docs?.ci?.runs ?? [];
  const ciGreen = ['dev', 'main'].every((branch) =>
    ciRuns.some((run) => run.headBranch === branch && run.conclusion === 'success'));
  const upstreamRuns = snapshot.upstream?.workflows?.flatMap((workflow) => workflow.runs ?? []) ?? [];
  const upstreamGreen = upstreamRuns.some((run) => run.conclusion === 'success');
  add(checks, 'current-run-evidence', ciGreen && upstreamGreen ? 'pass' : 'fail', ciGreen && upstreamGreen
    ? 'recent docs dev/main CI and upstream publisher run evidence is green'
    : 'missing green docs dev/main CI or upstream publisher run evidence');

  return summarize(checks);
}

function summarize(checks) {
  const counts = Object.fromEntries(['pass', 'fail', 'unknown'].map((status) => [
    status,
    checks.filter((check) => check.status === status).length,
  ]));
  return {
    status: counts.fail === 0 && counts.unknown === 0 ? 'pass' : 'fail',
    counts,
    checks,
  };
}

export function formatReport(snapshot, evaluation) {
  const mark = { pass: '✓', fail: '✗', unknown: '?' };
  return [
    `release-control preflight: ${evaluation.status.toUpperCase()} (${evaluation.counts.fail} failed, ${evaluation.counts.unknown} unknown)`,
    `observed: ${snapshot.observedAt ?? 'fixture'} | docs: ${snapshot.docs?.repository ?? 'unknown'} | upstream: ${snapshot.upstream?.repository ?? 'unknown'}`,
    ...evaluation.checks.map((check) => `${mark[check.status]} ${check.id}: ${check.message}`),
    'Secret and variable values were not requested or printed.',
  ].join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string', default: 'bestagentkits/agentkit-docs' },
      upstream: { type: 'string', default: 'bestagentkits/agentkit' },
      'upstream-ref': { type: 'string', default: 'dev' },
      snapshot: { type: 'string' },
      json: { type: 'boolean', default: false },
      'allow-blockers': { type: 'boolean', default: false },
      'repo-root': { type: 'string', default: process.cwd() },
    },
  });
  const snapshot = values.snapshot
    ? JSON.parse(readFileSync(resolve(values.snapshot), 'utf8'))
    : collectLiveState({
      repository: values.repo,
      upstreamRepository: values.upstream,
      upstreamRef: values['upstream-ref'],
      repoRoot: resolve(values['repo-root']),
    });
  const evaluation = evaluatePreflight(snapshot);
  if (values.json) {
    console.log(JSON.stringify(redactSensitive({
      schemaVersion: PREFLIGHT_SCHEMA_VERSION,
      observedAt: snapshot.observedAt,
      docsRepository: snapshot.docs?.repository,
      upstreamRepository: snapshot.upstream?.repository,
      ...evaluation,
    }), null, 2));
  } else {
    console.log(formatReport(snapshot, evaluation));
  }
  if (evaluation.status !== 'pass' && !values['allow-blockers']) process.exitCode = 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`check-release-control-preflight failed: ${redactSensitive(error.message)}`);
    process.exitCode = 1;
  });
}
