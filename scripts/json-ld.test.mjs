import assert from 'node:assert/strict';
import test from 'node:test';
import { jsonLdScript } from '../lib/json-ld.mjs';

test('escapes a script-breakout payload with no raw angle brackets or ampersand', () => {
  const out = jsonLdScript({ title: '</script><img src=x onerror=alert(1)>', note: 'A & B' });
  assert.equal(out.includes('<'), false);
  assert.equal(out.includes('>'), false);
  assert.equal(out.includes('&'), false);
});

test('escapes the Unicode line and paragraph separators', () => {
  const out = jsonLdScript({
    text: `line${String.fromCodePoint(0x2028)}sep${String.fromCodePoint(0x2029)}end`,
  });
  assert.equal(out.includes(String.fromCodePoint(0x2028)), false);
  assert.equal(out.includes(String.fromCodePoint(0x2029)), false);
  assert.match(out, /\\u2028/);
  assert.match(out, /\\u2029/);
});

test('escaping is reversible and round-trips to the original object', () => {
  const original = {
    title: '</script><img src=x onerror=alert(1)>',
    note: 'A & B',
    text: `line${String.fromCodePoint(0x2028)}end`,
  };
  const out = jsonLdScript(original);
  const unescaped = out
    .replaceAll('\\u003c', '<')
    .replaceAll('\\u003e', '>')
    .replaceAll('\\u0026', '&')
    .replaceAll('\\u2028', String.fromCodePoint(0x2028))
    .replaceAll('\\u2029', String.fromCodePoint(0x2029));
  assert.deepEqual(JSON.parse(unescaped), original);
});

test('a payload with no special characters parses unchanged', () => {
  const original = { '@type': 'WebSite', name: 'AgentKit Docs' };
  const out = jsonLdScript(original);
  assert.deepEqual(JSON.parse(out), original);
});
