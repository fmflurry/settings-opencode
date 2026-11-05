import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const org = 'https://dev.azure.com/Isagri-Prod-Progiciels';
const project = 'Isagri_Dev_GC_GestionCommerciale';
export function inScopeRemote(remote) {
  return /^(?:https:\/\/github\.com\/|git@github\.com:)SAIsagri\/gc\.platform(?:\.git)?$/i.test(remote.trim()) ||
    /^https:\/\/dev\.azure\.com\/Isagri-Prod-Progiciels\/Isagri_Dev_GC_GestionCommerciale\/_git\/[^/]+\/?$/i.test(remote.trim());
}
export function workItemId(branch, text) {
  const ids = new Set();
  const match = branch.match(/^[^/]+\/(\d+)-/);
  if (match) ids.add(match[1]);
  for (const ref of text.matchAll(/\bAB#(\d+)\b/gi)) ids.add(ref[1]);
  return ids.size === 1 ? [...ids][0] : null;
}
export function decide(item, phase) {
  const fields = item?.fields ?? {};
  if (fields['System.TeamProject'] !== project || !['Feature', 'User Story', 'Enabler', 'Enabler Story'].includes(fields['System.WorkItemType'])) return null;
  if (/(?:^|[;\s,])(?:security|vulnerability|vulnerabilit(?:y|é))(?:$|[;\s,])/i.test(fields['System.Tags'] ?? '')) return null;
  const state = fields['System.State'];
  if (phase === 'start' && state === 'New') return 'Active';
  if (phase === 'merged' && state === 'Active') return 'Resolved';
  return null;
}
function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
}
function main() {
  const [phase, branch = '', text = ''] = process.argv.slice(2);
  if (!['start', 'review', 'merged'].includes(phase)) { console.error('usage: ado-state start|review|merged <branch> [references]'); return 2; }
  const id = workItemId(branch, text);
  if (!id || phase === 'review' || /(?:^|[\/\s_-])(?:security|vulnerability)(?:$|[\/\s_-])/i.test(branch)) return 0;
  const remote = run('git', ['remote', 'get-url', 'origin']);
  if (remote.status !== 0 || !inScopeRemote(remote.stdout)) return 0;
  const read = run('az', ['boards', 'work-item', 'show', '--org', org, '--id', id, '--output', 'json', '--only-show-errors']);
  if (read.status !== 0) { console.error(`ado-state: could not read AB#${id}; Azure CLI missing, unavailable or not signed in`); return 0; }
  let item;
  try { item = JSON.parse(read.stdout); } catch { console.error(`ado-state: invalid response for AB#${id}`); return 0; }
  const state = decide(item, phase);
  if (!state) return 0;
  if (!Number.isInteger(item.rev)) { console.error(`ado-state: missing revision for AB#${id}`); return 0; }
  const dir = mkdtempSync(join(tmpdir(), 'harness-ado-'));
  try {
    const file = join(dir, 'patch.json');
    writeFileSync(file, JSON.stringify([{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/fields/System.State', value: state }]), { mode: 0o600 });
    const update = run('az', ['rest', '--method', 'patch', '--url', `${org}/${project}/_apis/wit/workitems/${id}?api-version=7.1`, '--resource', '499b84ac-1321-427f-aa17-267ca6975798', '--headers', 'Content-Type=application/json-patch+json', '--body', `@${file}`, '--output', 'none', '--only-show-errors']);
    if (update.status !== 0) console.error(`ado-state: could not update AB#${id}; it may have changed, or Azure CLI is unavailable`);
    else console.error(`ado-state: AB#${id} → ${state}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
