import { readFile } from 'node:fs/promises';

export function parseArgs(argv, allowed) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--') || !allowed.includes(flag)) throw new Error(`unknown argument ${flag}`);
    if (result[flag] !== undefined) throw new Error(`duplicate argument ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    result[flag] = value;
    i += 1;
  }
  return result;
}

export function required(args, flags) {
  for (const flag of flags) if (!args[flag]) throw new Error(`missing required argument ${flag}`);
  return args;
}

export async function readJson(path, label = path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${label}: ${error.message}`);
  }
}

export function cliError(error) {
  process.stderr.write(`docs release update: ${error.message}\n`);
  process.exitCode = 1;
}
