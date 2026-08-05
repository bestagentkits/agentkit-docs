import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { normalizeRepoPath } from './docs-release-paths.mjs';

const BLOCK = 512;
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

function field(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end)).trim();
}

function octal(value, label) {
  if (!/^[0-7]+$/.test(value)) throw new Error(`invalid tar ${label}`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`invalid tar ${label}`);
  return parsed;
}

function validateChecksum(header) {
  const expected = octal(field(header, 148, 8), 'checksum');
  let actual = 0;
  for (let i = 0; i < BLOCK; i += 1) actual += i >= 148 && i < 156 ? 32 : header[i];
  if (actual !== expected) throw new Error('tar header checksum mismatch');
}

function isZeroBlock(block) {
  return block.every((byte) => byte === 0);
}

export async function readTarGzipEntries(path) {
  const compressed = await readFile(path);
  let archive;
  try {
    archive = gunzipSync(compressed, { maxOutputLength: MAX_TOTAL_BYTES + MAX_FILES * BLOCK });
  } catch (error) {
    throw new Error(`invalid docs bundle gzip: ${error.message}`);
  }
  const entries = new Map();
  let offset = 0;
  let totalBytes = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (isZeroBlock(header)) break;
    validateChecksum(header);
    const prefix = field(header, 345, 155);
    const name = field(header, 0, 100);
    const rawPath = prefix ? `${prefix}/${name}` : name;
    const size = octal(field(header, 124, 12), 'size');
    const type = String.fromCharCode(header[156] || 48);
    offset += BLOCK;
    const withoutDot = rawPath.startsWith('./') ? rawPath.slice(2) : rawPath;
    const candidatePath = type === '5' ? withoutDot.replace(/\/+$/, '') : withoutDot;
    if (type === '5' && (candidatePath === '' || candidatePath === '.')) continue;
    const path = normalizeRepoPath(candidatePath);
    if (offset + size > archive.length) throw new Error(`truncated tar entry ${path}`);
    if (type === '5') {
      if (size !== 0) throw new Error(`tar directory ${path} carries data`);
    } else if (type === '0') {
      if (size > MAX_FILE_BYTES) throw new Error(`tar entry exceeds file limit: ${path}`);
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('docs bundle exceeds extraction budget');
      if (entries.has(path)) throw new Error(`duplicate tar entry ${path}`);
      entries.set(path, Buffer.from(archive.subarray(offset, offset + size)));
      if (entries.size > MAX_FILES) throw new Error('docs bundle has too many files');
    } else {
      throw new Error(`unsupported tar entry type ${JSON.stringify(type)} for ${path}`);
    }
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  if (!entries.size) throw new Error('docs bundle tar contains no files');
  return entries;
}
