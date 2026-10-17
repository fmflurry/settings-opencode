import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isAllowedReviewSeverity, reviewSeverityWords, scanReviewSeverities } from './review-tags.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('ignores words that are not review severities', () => {
  for (const sample of [
    'high-level design',
    'low-latency path',
    'reasoning_effort high',
    'grok-4.7-high',
    'grok-4.6-xhigh',
    'composer-2.5',
    'a critical comment in lowercase',
  ]) {
    assert.deepEqual(reviewSeverityWords(sample), [], sample);
  }
});

test('flags review-severity words', () => {
  assert.deepEqual(reviewSeverityWords('Treat this as [HIGH] and CRITICAL'), ['HIGH', 'CRITICAL']);
});

test('allowlist keeps business risk scales and external audit levels', () => {
  assert.equal(isAllowedReviewSeverity('skills/gdpr-compliance/SKILL.md', '**HIGH** password tier'), true);
  assert.equal(isAllowedReviewSeverity('.claude/agents/postgres-dba.md', '- **CRITICAL:** XID wraparound'), true);
  assert.equal(isAllowedReviewSeverity('commands/db-health.md', 'CRITICAL → HIGH → MEDIUM → LOW'), true);
  assert.equal(isAllowedReviewSeverity('commands/plan.md', '- HIGH: [Critical risks that could block implementation]'), true);
  assert.equal(isAllowedReviewSeverity('.claude/commands/plan.md', '**CRITICAL**: Do NOT write any code'), false);
  assert.equal(
    isAllowedReviewSeverity('skills/security-review/SKILL.md', 'CI runs `npm audit` and fails if CRITICAL or HIGH CVEs found.'),
    true,
  );
  assert.equal(
    isAllowedReviewSeverity('prompts/agents/security-reviewer.txt', '- **Risk Level:** HIGH / MEDIUM / LOW'),
    true,
  );
  assert.equal(isAllowedReviewSeverity('skills/ship/SKILL.md', 'Every confirmed CRITICAL finding is a blocker'), false);
});

test('harness sources have no disallowed review severities', () => {
  const hits = scanReviewSeverities(repo);
  assert.deepEqual(hits, [], hits.map((hit) => `${hit.file}:${hit.line}: ${hit.text}`).join('\n'));
});
