import assert from 'node:assert/strict';
import test from 'node:test';
import { sitePathForHref } from './check-links.mjs';

test('resolves root and relative links against an exported page URL', () => {
  const out = '/repo/out';
  const file = '/repo/out/en/beta/reference/cli/agents/install.html';

  assert.equal(sitePathForHref(out, file, '/en/beta'), '/en/beta');
  assert.equal(
    sitePathForHref(out, file, '../cli-conventions'),
    '/en/beta/reference/cli/cli-conventions',
  );
  assert.equal(sitePathForHref(out, file, 'base-ui-disable-scrollbar'), undefined);
});
