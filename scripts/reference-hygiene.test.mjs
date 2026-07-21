import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findReferenceLeaks } from './lib/reference-hygiene.mjs';

test('flags internal ADR references', () => {
  assert.equal(findReferenceLeaks('see ADR 0014 for details').length, 1);
  assert.equal(findReferenceLeaks('ADR 0031 and ADR 0033').length, 2);
});

test('flags private source-repo URLs but not the public repos', () => {
  assert.equal(findReferenceLeaks('https://github.com/bestagentkits/agentkit').length, 1);
  assert.equal(findReferenceLeaks('https://github.com/bestagentkits/agentkit/releases').length, 1);
  assert.equal(findReferenceLeaks('https://github.com/bestagentkits/agentkit-support').length, 0);
  assert.equal(findReferenceLeaks('https://github.com/bestagentkits/agentkit-docs/blob/main/x').length, 0);
});

test('flags private repo docs paths, except tracked allowlist', () => {
  assert.equal(findReferenceLeaks('see docs/adr/0034-promotion.md').length, 1);
  assert.equal(findReferenceLeaks('see docs/operations/release-procedure.md').length, 1);
  // Allowlisted (tracked upstream: ak#1102).
  assert.equal(findReferenceLeaks('see docs/specs/ux-contract.md for the envelope').length, 0);
});

test('does NOT flag issue numbers or MDX brace escapes (would corrupt JSON examples)', () => {
  assert.deepEqual(findReferenceLeaks('fixed in #1091 and #123'), []);
  assert.deepEqual(findReferenceLeaks('JSON: &#123;"a":1&#125; and literal {x}'), []);
});

test('clean reference text yields no findings', () => {
  assert.deepEqual(findReferenceLeaks('Install or build a kit. Run `ak kit init engineer`.'), []);
});
