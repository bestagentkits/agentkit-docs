import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluatePreflight,
  formatReport,
  redactSensitive,
  REQUIRED,
} from './check-release-control-preflight.mjs';
import { validateDurableApprovalRecord } from './lib/docs-release-approval.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function schemaTarget(root, reference) {
  return reference.slice(2).split('/').reduce((value, key) => value[key], root);
}

function validateSchemaValue(value, schema, root, label = '$') {
  if (schema.$ref) return validateSchemaValue(value, schemaTarget(root, schema.$ref), root, label);
  if (schema.const !== undefined) assert.deepEqual(value, schema.const, `${label} const`);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${label} enum`);
  if (schema.type === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} object`);
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), `${label}.${key} required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) assert.ok(Object.hasOwn(schema.properties ?? {}, key), `${label}.${key} additional`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) validateSchemaValue(value[key], child, root, `${label}.${key}`);
    }
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value), `${label} array`);
    if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems, `${label} minItems`);
    if (schema.maxItems !== undefined) assert.ok(value.length <= schema.maxItems, `${label} maxItems`);
    if (schema.uniqueItems) assert.equal(new Set(value.map((item) => JSON.stringify(item))).size, value.length, `${label} uniqueItems`);
    value.forEach((item, index) => validateSchemaValue(item, schema.items, root, `${label}[${index}]`));
  } else if (schema.type === 'string') {
    assert.equal(typeof value, 'string', `${label} string`);
    if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength, `${label} minLength`);
    if (schema.pattern) assert.match(value, new RegExp(schema.pattern), `${label} pattern`);
    if (schema.format === 'date-time') assert.ok(!Number.isNaN(Date.parse(value)), `${label} date-time`);
    if (schema.format === 'uri') assert.doesNotThrow(() => new URL(value), `${label} uri`);
  } else if (schema.type === 'integer') {
    assert.ok(Number.isInteger(value), `${label} integer`);
    if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, `${label} minimum`);
  }
}

function greenPolicy(branch) {
  return {
    observable: true,
    active: true,
    sources: [`ruleset:${branch}`],
    requirePullRequest: true,
    requiredApprovingReviewCount: 1,
    requireCodeOwnerReview: true,
    dismissStaleReviews: true,
    requiredChecks: [...REQUIRED.checks],
    bypassActors: branch === 'dev'
      ? [{ type: 'Integration', login: 'agentkit-docs-bot', mode: 'always' }]
      : [],
    blocksForcePushes: true,
    blocksDeletions: true,
  };
}

function greenFixture() {
  const successfulRun = {
    id: 1,
    event: 'repository_dispatch',
    conclusion: 'success',
    headBranch: 'dev',
    headSha: 'a'.repeat(40),
  };
  return {
    schemaVersion: 1,
    observedAt: '2026-08-04T00:00:00Z',
    docs: {
      repository: 'example/agentkit-docs',
      secretNames: [...REQUIRED.secrets],
      variableNames: [...REQUIRED.variables],
      labelNames: [...REQUIRED.labels],
      apps: Object.fromEntries(REQUIRED.apps.map((slug, index) => [slug, {
        identityObservable: true,
        exists: true,
        id: index + 1,
        login: slug,
        installationObservable: true,
        installed: true,
        suspended: false,
      }])),
      codeowners: {
        observable: true,
        owners: ['@example/docs-maintainers'],
        errors: [],
      },
      branches: {
        dev: greenPolicy('dev'),
        main: greenPolicy('main'),
      },
      environments: {
        observable: true,
        items: {
          staging: {
            exists: true,
            protectionRules: [],
            branchPolicy: { protected_branches: false, custom_branch_policies: true },
          },
          production: {
            exists: true,
            protectionRules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', id: 7 }] }],
            branchPolicy: { protected_branches: true, custom_branch_policies: false },
          },
        },
      },
      workflows: {
        'docs-sync.yml': { observable: true, state: 'active', runs: [successfulRun, { ...successfulRun, id: 2 }] },
        'docs-agent.yml': { observable: true, state: 'active', runs: [] },
        'agent-guard.yml': { observable: true, state: 'active', runs: [] },
      },
      guardContract: {
        observable: true,
        labelTriggerPresent: true,
        authorTriggerLogin: 'agentkit-docs-agent[bot]',
      },
      ci: {
        observable: true,
        runs: [
          { event: 'push', conclusion: 'success', headBranch: 'dev' },
          { event: 'push', conclusion: 'success', headBranch: 'main' },
        ],
      },
      tags: ['docs/v2.8.0-beta.2', 'docs/v2.7.0'],
    },
    upstream: {
      repository: 'example/agentkit',
      secretNames: [REQUIRED.upstreamSecret],
      producer: {
        observable: true,
        generatorPresent: true,
        bundleUploadPresent: true,
        checksumOrProvenancePresent: true,
        dispatchPresent: true,
      },
      releases: {
        observable: true,
        releases: [
          {
            tag: 'v2.8.0-beta.2',
            prerelease: true,
            assets: ['docs-bundle.tar.gz', 'docs-bundle.tar.gz.sha256'],
          },
          {
            tag: 'v2.7.0',
            prerelease: false,
            assets: ['docs-bundle.tar.gz', 'docs-bundle.tar.gz.sha256'],
          },
        ],
      },
      workflows: [{
        observable: true,
        runs: [{ event: 'workflow_dispatch', conclusion: 'success', headBranch: 'v2.8.0-beta.2' }],
      }],
    },
  };
}

test('green fixture passes every release-control check', () => {
  const result = evaluatePreflight(greenFixture());
  assert.equal(result.status, 'pass');
  assert.equal(result.counts.fail, 0);
  assert.equal(result.counts.unknown, 0);
});

test('missing fixture fails closed without throwing', () => {
  const fixture = {
    schemaVersion: 1,
    docs: {
      repository: 'example/agentkit-docs',
      secretNames: [],
      variableNames: [],
      labelNames: [],
      apps: {},
      codeowners: { observable: true, owners: [], errors: [] },
      branches: {},
      environments: { observable: true, items: {} },
      workflows: {},
      guardContract: { observable: false, labelTriggerPresent: false, authorTriggerLogin: null },
      ci: { runs: [] },
      tags: [],
    },
    upstream: {
      repository: 'example/agentkit',
      secretNames: [],
      producer: null,
      releases: { observable: true, releases: [] },
      workflows: [],
    },
  };
  const result = evaluatePreflight(fixture);
  assert.equal(result.status, 'fail');
  assert.ok(result.counts.fail >= 10);
  assert.ok(result.checks.some((check) => check.id === 'repo-secrets' && check.status === 'fail'));
  assert.ok(result.checks.some((check) => check.id === 'branch-dev' && check.status === 'unknown'));
});

test('invalid fixture detects authority expansion and false protection', () => {
  const fixture = greenFixture();
  fixture.docs.branches.dev.bypassActors.push({
    type: 'Integration',
    login: 'agentkit-docs-agent',
    mode: 'always',
  });
  fixture.docs.branches.main.bypassActors.push({ type: 'User', login: 'admin', mode: 'always' });
  fixture.docs.branches.main.requiredChecks = ['build'];
  fixture.docs.environments.items.production.protectionRules = [];
  fixture.docs.codeowners.errors = [{ kind: 'Unknown owner', line: 1 }];
  fixture.docs.guardContract.authorTriggerLogin = 'agentkit-docs-bot[bot]';
  fixture.upstream.releases.releases[0].assets = ['docs-bundle.tar.gz'];

  const result = evaluatePreflight(fixture);
  assert.equal(result.status, 'fail');
  for (const id of ['branch-dev', 'branch-main', 'environments', 'codeowners', 'guard-identity', 'upstream-release-assets']) {
    assert.ok(result.checks.some((check) => check.id === id && check.status === 'fail'), id);
  }
  assert.match(result.checks.find((check) => check.id === 'branch-dev').message, /docs-agent or human bypass/);
  assert.match(result.checks.find((check) => check.id === 'branch-main').message, /main must have no bypass/);
});

test('unobservable App installation is reported as unknown and blocks green', () => {
  const fixture = greenFixture();
  fixture.docs.apps['agentkit-docs-agent'].installationObservable = false;
  fixture.docs.apps['agentkit-docs-agent'].installed = null;
  const result = evaluatePreflight(fixture);
  assert.equal(result.status, 'fail');
  assert.ok(result.checks.some((check) =>
    check.id === 'app-agentkit-docs-agent' && check.status === 'unknown'));
});

test('redaction removes values and credential-like text but retains required names', () => {
  const secret = 'gho_abcdefghijklmnopqrstuvwxyz123456';
  const redacted = redactSensitive({
    token: secret,
    accessToken: 'access-token-must-not-print',
    value: 'must-not-print',
    nested: { privateKey: '-----BEGIN PRIVATE KEY-----\nabc' },
    message: `request used ${secret}`,
    secretNames: REQUIRED.secrets,
  });
  const output = JSON.stringify(redacted);
  assert.doesNotMatch(output, /must-not-print|access-token-must-not-print|gho_abcdefghijklmnopqrstuvwxyz|BEGIN PRIVATE KEY/);
  assert.match(output, /\[REDACTED\]/);
  assert.ok(redacted.secretNames.includes('DOCS_BOT_PRIVATE_KEY'));
});

test('human report never serializes fixture credential values', () => {
  const fixture = greenFixture();
  fixture.docs.token = 'github_pat_abcdefghijklmnopqrstuvwxyz';
  const report = formatReport(fixture, evaluatePreflight(fixture));
  assert.doesNotMatch(report, /github_pat_/);
  assert.match(report, /values were not requested or printed/);
});

test('durable approval example validates against the JSON schema and runtime contract', async () => {
  const schema = JSON.parse(await readFile(resolve(repoRoot, 'docs-approvals/v1.schema.json'), 'utf8'));
  const example = JSON.parse(await readFile(resolve(repoRoot, 'docs-approvals/v1.example.json'), 'utf8'));
  validateSchemaValue(example, schema, schema);
  assert.equal(
    validateDurableApprovalRecord(example, { now: '2026-08-05T00:00:00Z' }),
    example,
  );
});
