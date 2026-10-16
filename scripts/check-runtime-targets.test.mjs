import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkCatalog,
  checkFixtureShape,
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
    .map((t) => `  ${t.id}:\n    dispatch: ${t.id === 'pi' ? 'none' : 'native'}\n    status: ${t.support}`)
    .concat(fixture.exportOnly.map((id) => `  ${id}:\n    dispatch: none\n    status: spike`))
    .join('\n');
  const matrix = parseMatrix(`schema_version: 1\nruntimes:\n${yaml}\n`);
  assert.deepEqual(checkSourceMatrix(fixture, matrix), []);
  matrix.grok.status = 'production';
  matrix.pi.dispatch = 'native';
  const errors = checkSourceMatrix(fixture, matrix).join('\n');
  assert.match(errors, /grok: source status production != fixture spike/);
  assert.match(errors, /pi must have no dispatch/);
});

test('Beta prose matches the fixture in both locales', () => {
  assert.deepEqual(runChecks(), []);
});
