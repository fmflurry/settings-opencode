#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function git(args, input) {
  const result = spawnSync('git', args, { input, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}
function entries(base, head) {
  const baseSha = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  const headSha = git(['rev-parse', '--verify', '--end-of-options', `${head}^{commit}`]).trim();
  const commits = git(['rev-list', '--reverse', `${baseSha}..${headSha}`]).trim().split('\n').filter(Boolean);
  return commits.flatMap((commit) => {
    const message = git(['show', '-s', '--format=%B', commit]);
    const trailers = git(['interpret-trailers', '--parse'], message).split('\n');
    const values = new Map();
    for (const trailer of trailers) {
      const match = trailer.match(/^(Harness|Harness-SHA|Session-Id):\s*(.*?)\s*$/i);
      if (match) values.set(match[1].toLowerCase(), match[2]);
    }
    if (!values.get('harness')?.startsWith('fmflurry-harness@')) return [];
    if (!values.get('harness-sha') || !values.get('session-id')) throw new Error(`incomplete provenance in ${commit}`);
    return [`- \`${commit}\` | \`Harness: ${values.get('harness')}\` | \`Harness-SHA: ${values.get('harness-sha')}\` | \`Session-Id: ${values.get('session-id')}\``];
  });
}
function check(body, records) {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^## Commit provenance[ \t]*$/.test(line));
  const remainder = start < 0 ? [] : lines.slice(start + 1);
  const end = remainder.findIndex((line) => /^##[ \t]/.test(line));
  const section = end < 0 ? remainder : remainder.slice(0, end);
  if (records.some((record) => !section.includes(record))) throw new Error('PR body is missing commit provenance; run agent-harness pr-provenance list <base> HEAD and paste its output');
}
try {
  const [, , mode, base, head, bodyFile] = process.argv;
  if (mode === 'merge' || mode === 'merge-json') {
    if (base && !/^(?:[0-9]+|https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[0-9]+)$/.test(base)) throw new Error('PR must be a number or a GitHub pull request URL');
    const args = ['pr', 'view', ...(base ? [base] : []), '--json', 'baseRefOid,headRefOid,body'];
    if (!/^[a-f0-9]{40,64}$/.test(head || '')) throw new Error('merge requires --match-head-commit with the PR head SHA');
    const gh = process.env.HARNESS_GH_COMMAND || 'gh';
    if (!/(^|\/)gh(?:-[A-Za-z0-9_-]+)?$/.test(gh)) throw new Error('invalid GitHub command');
    const result = mode === 'merge-json' ? { status: 0, stdout: fs.readFileSync(0, 'utf8') } : spawnSync(gh, args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('cannot read PR before merge');
    const pr = JSON.parse(result.stdout);
    if (!/^[a-f0-9]{40,64}$/.test(pr.baseRefOid || '') || !/^[a-f0-9]{40,64}$/.test(pr.headRefOid || '') || typeof pr.body !== 'string') throw new Error('invalid PR metadata');
    if (pr.headRefOid !== head) throw new Error('PR head changed; refresh the body and retry with the current head SHA');
    check(pr.body, entries(pr.baseRefOid, pr.headRefOid));
  } else {
    if (!['list', 'check'].includes(mode) || !base || !head || (mode === 'check' && !bodyFile)) throw new Error('usage: pr-provenance.mjs list <base> <head> | check <base> <head> <body-file> | merge [PR]');
    const records = entries(base, head);
    if (mode === 'list') {
      if (records.length) console.log(`## Commit provenance\n\n${records.join('\n')}`);
    } else {
      check(fs.readFileSync(bodyFile === '-' ? 0 : bodyFile, 'utf8'), records);
    }
  }
} catch (error) {
  console.error(`pr-provenance: ${error.message}`);
  process.exitCode = 1;
}
