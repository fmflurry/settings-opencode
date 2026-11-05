import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, workItemId, inScopeRemote } from '../ado-state.mjs';

test('finds one unambiguous branch or explicit AB reference', () => {
  assert.equal(workItemId('feat/123-thing', ''), '123');
  assert.equal(workItemId('feat/foo', 'work on AB#456'), '456');
  assert.equal(workItemId('feat/123-thing', 'AB#456'), null);
  assert.equal(workItemId('feat/no-id', ''), null);
});
test('only advances in-scope types in the target project', () => {
  const item = (type, state, project = 'Isagri_Dev_GC_GestionCommerciale') => ({ fields: { 'System.TeamProject': project, 'System.WorkItemType': type, 'System.State': state } });
  for (const type of ['Feature', 'User Story', 'Enabler', 'Enabler Story']) {
    assert.equal(decide(item(type, 'New'), 'start'), 'Active');
    assert.equal(decide(item(type, 'Active'), 'merged'), 'Resolved');
    assert.equal(decide(item(type, 'Resolved'), 'start'), null);
    assert.equal(decide(item(type, 'Closed'), 'merged'), null);
    assert.equal(decide(item(type, 'Removed'), 'start'), null);
  }
  assert.equal(decide(item('Bug', 'New'), 'start'), null);
  const securityItem = item('Feature', 'New');
  securityItem.fields['System.Tags'] = 'security; urgent';
  assert.equal(decide(securityItem, 'start'), null);
  assert.equal(decide(item('Feature', 'New', 'Other'), 'start'), null);
  assert.equal(decide(item('Feature', 'New'), 'review'), null);
});

test('only resolves IDs within the associated repository or Azure project', () => {
  assert.equal(inScopeRemote('https://github.com/SAIsagri/gc.platform.git'), true);
  assert.equal(inScopeRemote('git@github.com:SAIsagri/gc.platform.git'), true);
  assert.equal(inScopeRemote('https://dev.azure.com/Isagri-Prod-Progiciels/Isagri_Dev_GC_GestionCommerciale/_git/foo'), true);
  assert.equal(inScopeRemote('https://github.com/fmflurry/settings-opencode.git'), false);
});

test('CLI issues revision-guarded updates and tolerates Azure failures', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'ado-test-'));
  try {
    const fakeGit = join(dir, 'git');
    writeFileSync(fakeGit, '#!/bin/sh\necho https://github.com/SAIsagri/gc.platform.git\n'); chmodSync(fakeGit, 0o755);
    const fakeAz = join(dir, 'az');
    writeFileSync(fakeAz, `#!/bin/sh\nif [ "$1" = boards ]; then printf '%s' '{"rev":12,"fields":{"System.TeamProject":"Isagri_Dev_GC_GestionCommerciale","System.WorkItemType":"Feature","System.State":"Active"}}'; exit 0; fi\nwhile [ "$1" != --body ]; do shift; done\nfile="\${2#@}"\ncp "$file" "$PATCH_OUT"\n`); chmodSync(fakeAz, 0o755);
    const env = { ...process.env, PATH: `${dir}:/usr/bin:/bin`, PATCH_OUT: join(dir, 'patch') };
    const script = new URL('../ado-state.mjs', import.meta.url).pathname;
    let result = spawnSync(process.execPath, [script, 'merged', 'feat/123-example'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(readFileSync(env.PATCH_OUT, 'utf8')), [{ op: 'test', path: '/rev', value: 12 }, { op: 'add', path: '/fields/System.State', value: 'Resolved' }]);
    writeFileSync(fakeAz, '#!/bin/sh\nexit 1\n');
    result = spawnSync(process.execPath, [script, 'start', 'feat/123-example'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /could not read/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
