import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkCatalog,
  checkFixtureShape,
  checkProse,
  checkSourceMatrix,
  loadFixture,
  parseMatrix,
  runChecks,
} from './check-runtime-targets.mjs';

const fixture = loadFixture();
const clone = (v) => JSON.parse(JSON.stringify(v));
const released = (extra = []) => ({
  channels: {
    beta: { runtimes: [...fixture.setupTargets.map((t) => t.id), ...fixture.distributionOnly, ...extra] },
  },
});

test('fixture lists seven setup targets and keeps export-only names out', () => {
  assert.deepEqual(checkFixtureShape(fixture), []);
  assert.equal(fixture.setupTargets.length, 7);
  assert.deepEqual(fixture.exportOnly, ['agy', 'portable']);
});

test('fixture rejects an export-only name promoted to a setup target', () => {
  const bad = clone(fixture);
  bad.setupTargets[6] = { id: 'agy', name: 'Pi', support: 'spike', runDispatch: false };
  assert.match(checkFixtureShape(bad).join('\n'), /agy is export-only/);
});

test('catalog check requires every setup target in released packages', () => {
  assert.deepEqual(checkCatalog(fixture, released()), []);
  const missing = released();
  missing.channels.beta.runtimes = missing.channels.beta.runtimes.filter((r) => r !== 'dsh');
  assert.match(checkCatalog(fixture, missing).join('\n'), /miss setup target dsh/);
});

test('catalog check rejects an export-only runtime in released packages', () => {
  assert.match(checkCatalog(fixture, released(['agy'])).join('\n'), /export-only agy/);
});

test('source matrix check compares support level and pi dispatch', () => {
  const yaml = fixture.setupTargets
    .map((t) => `  ${t.id}:\n    dispatch: ${t.runDispatch ? 'native' : 'none'}\n    status: ${t.support}`)
    .concat(fixture.exportOnly.map((id) => `  ${id}:\n    dispatch: none\n    status: spike`))
    .join('\n');
  const matrix = parseMatrix(`schema_version: 1\nruntimes:\n${yaml}\n`);
  assert.deepEqual(checkSourceMatrix(fixture, matrix), []);
  matrix.grok.status = 'production';
  matrix.pi.dispatch = 'native';
  const errors = checkSourceMatrix(fixture, matrix).join('\n');
  assert.match(errors, /grok: source status production != fixture spike/);
  assert.match(errors, /pi: fixture runDispatch false disagrees/);
});

test('Beta prose matches the fixture in both locales', () => {
  assert.deepEqual(runChecks(), []);
});

function proseWith(mutate) {
  const root = mkdtempSync(path.join(tmpdir(), 'runtime-targets-'));
  for (const rel of Object.values(fixture.documentedPages)) {
    for (const locale of ['en', 'vi']) {
      const file = `content/docs/beta/${rel}.${locale}.mdx`;
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      const body = readFileSync(file, 'utf8');
      writeFileSync(path.join(root, file), locale === 'en' ? mutate(rel, body) : body);
    }
  }
  return checkProse(fixture, root);
}

test('prose guard flags a pi dispatch claim split across code spans', () => {
  const errors = proseWith((rel, body) =>
    rel === 'kits/index' ? body.replace(/there is no `ak run --target pi`\./, '`ak run` also supports `--target pi`.') : body);
  assert.match(errors.join('\n'), /unqualified `ak run --target pi`/);
});

test('prose guard flags a table-row pi dispatch claim even if other rows negate it', () => {
  const errors = proseWith((rel, body) =>
    rel === 'kits/index' ? body.replace(/^\| Pi \|.*$/m, '| Pi | `ak run --target pi` | Dispatches Skills. |') : body);
  assert.match(errors.join('\n'), /unqualified `ak run --target pi`/);
});

test('prose guard flags a deleted Pi row that Oh My Pi text would otherwise mask', () => {
  const errors = proseWith((rel, body) => (rel === 'kits/index' ? body.replace(/^\| Pi \|.*\n/m, '') : body));
  assert.match(errors.join('\n'), /no row for Pi/);
});
