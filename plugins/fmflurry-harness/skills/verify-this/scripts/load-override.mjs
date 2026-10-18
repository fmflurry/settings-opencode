#!/usr/bin/env node
import path from 'node:path';
import { detectHarness, resolveOverride, runCommands } from './lib.mjs';

const args = process.argv.slice(2);
let root = process.cwd();
let harness = detectHarness();
let run = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--root') root = path.resolve(args[++i] ?? '');
  else if (arg === '--harness') harness = args[++i] ?? '';
  else if (arg === '--run') run = true;
  else if (arg === '--print') run = false;
  else {
    console.error(`unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (harness && !['cursor', 'opencode', 'claude'].includes(harness)) {
  console.error(`unknown harness: ${harness}`);
  process.exit(2);
}

const found = resolveOverride(root, harness || null);
if (found.kind === 'default') {
  console.log('default');
  process.exit(0);
}

console.log(`override ${found.skill}`);
for (const entry of found.spec.commands) {
  console.log(`${entry.run ? 'run' : 'skip'} ${entry.id} ${entry.command}`);
}
if (!run) process.exit(0);

const result = runCommands(root, found.spec);
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status);
