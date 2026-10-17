import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitize } from './lib.mjs';

test('sanitize does not treat /workspace as a prefix of /workspaces', () => {
  const text = 'trash ~/orca/workspaces/<repo>/.orca-worktree-trash/ and read /workspace/skills';
  assert.equal(
    sanitize(text, '/workspace', 'settings-opencode'),
    'trash ~/orca/workspaces/<repo>/.orca-worktree-trash/ and read <repo>/skills',
  );
});

test('sanitize rewrites the author checkout when the clone directory is generic', () => {
  const text = 'vi /Users/fmflurry/Workspace/settings-opencode/.claude/agents';
  assert.equal(
    sanitize(text, '/workspace', 'settings-opencode'),
    'vi <repo>/.claude/agents',
  );
});

test('sanitize still rewrites a normal mac checkout', () => {
  const repo = '/Users/fmflurry/Workspace/settings-opencode';
  const text = `vi ${repo}/opencode.jsonc and /Users/other/bin`;
  assert.equal(
    sanitize(text, repo, 'settings-opencode'),
    'vi <repo>/opencode.jsonc and /home/user/bin',
  );
});
