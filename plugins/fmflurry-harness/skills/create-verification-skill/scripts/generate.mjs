#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function findLib() {
  let dir = here;
  for (let i = 0; i < 8; i += 1) {
    const candidates = [
      path.join(dir, 'verify-this', 'scripts', 'lib.mjs'),
      path.join(dir, 'skills', 'verify-this', 'scripts', 'lib.mjs'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('verify-this/scripts/lib.mjs not found');
}

const { detectHarness, generate } = await import(pathToFileURL(findLib()).href);

const args = process.argv.slice(2);
let root = process.cwd();
let harness = detectHarness();

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--root') root = path.resolve(args[++i] ?? '');
  else if (arg === '--harness') harness = args[++i] ?? '';
  else {
    console.error(`unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (harness !== 'cursor' && harness !== 'opencode' && harness !== 'claude') {
  console.error('pass --harness cursor, --harness opencode, or --harness claude');
  process.exit(2);
}

const result = generate(root, harness);
if (!result.written) {
  console.error('no build, test, or e2e command discovered');
  process.exit(2);
}
console.log(result.dir);
