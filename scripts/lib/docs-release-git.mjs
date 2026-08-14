import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { compareText, stableJson } from './docs-release-normalize.mjs';
import { normalizeRepoPath } from './docs-release-paths.mjs';

const execFileAsync = promisify(execFile);
const FULL_SHA = /^[0-9a-f]{40}$/;

async function git(root, args) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new Error(`cannot inspect V1 Git state: ${error.message}`);
  }
}

export function normalizeV1Changes(changes) {
  if (!Array.isArray(changes)) throw new Error('V1 changes must be an array');
  return changes.map((change) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) {
      throw new Error('V1 change entries must be objects');
    }
    return {
      status: String(change.status).toUpperCase(),
      path: normalizeRepoPath(change.path),
    };
  }).sort((left, right) => compareText(left.path, right.path) || compareText(left.status, right.status));
}

export async function resolveV1GitChanges(repoRoot, docsBaseSha) {
  if (typeof docsBaseSha !== 'string' || !FULL_SHA.test(docsBaseSha)) {
    throw new Error('V1 docs base SHA is invalid');
  }
  const root = await realpath(resolve(repoRoot));
  const topLevel = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  if (await realpath(topLevel) !== root) throw new Error('V1 repo root must be the Git top-level directory');
  const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  if (head !== docsBaseSha) {
    throw new Error(`current docs HEAD ${head} does not match V1 docs base SHA ${docsBaseSha}`);
  }
  const output = await git(root, [
    'diff', '--no-ext-diff', '--name-status', '-z', '--no-renames', docsBaseSha, '--',
  ]);
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 2 !== 0) throw new Error('cannot parse V1 Git change set');
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    changes.push({ status: fields[index], path: fields[index + 1] });
  }
  return normalizeV1Changes(changes);
}

export function assertV1ChangeManifest(suppliedChanges, actualChanges) {
  const supplied = normalizeV1Changes(suppliedChanges);
  const actual = normalizeV1Changes(actualChanges);
  if (stableJson(supplied) !== stableJson(actual)) {
    throw new Error('V1 change manifest does not match the current Git diff');
  }
  return actual;
}
