import { createHash } from 'node:crypto';

export function normalizeText(value) {
  return String(value).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trimEnd() + '\n';
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

export function digest(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === 'string' ? normalizeText(value) : stableJson(value));
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function compareText(a, b) {
  return a < b ? -1 : (a > b ? 1 : 0);
}

export function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

export function withoutKey(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}
