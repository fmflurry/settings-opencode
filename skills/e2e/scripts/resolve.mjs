#!/usr/bin/env node
import path from 'node:path';
import { detectHarness, HARNESSES, resolveE2E } from './lib.mjs';

let root = process.cwd();
let harness = detectHarness();

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === '--root') root = path.resolve(process.argv[++i] ?? '');
  else if (arg === '--harness') harness = process.argv[++i] ?? '';
  else {
    console.error(`unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (harness && !HARNESSES.includes(harness)) {
  console.error(`unknown harness: ${harness}`);
  process.exit(2);
}

console.log(`${JSON.stringify(resolveE2E(root, harness || null), null, 2)}\n`);
