import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'
import {
  AUTONOMY_FLAG,
  GOALS_DIR,
  HARNESS_MARKERS,
  isBandVisible,
  pickGoal,
  shownGoal,
  summary,
  toastsFor,
} from './model'
import type { GoalFile } from './model'
import { countersView, goalHeaderView, modeView, statusView } from './views'

const POLL_MS = 3000
const COMMAND = 'autonomy-status'

const snapshotAtom = atom({ plugin: 'autonomy-status', key: 'snapshot' } as const, null)
const startedAtAtom = atom({ plugin: 'autonomy-status', key: 'startedAt' } as const, 0)

const resolveFrom = (base: string, rel: string): string => {
  const out: string[] = []
  for (const part of (rel.startsWith('/') ? rel : `${base}/${rel}`).split('/')) {
    if (part === '..') out.pop()
    else if (part !== '' && part !== '.') out.push(part)
  }
  return `/${out.join('/')}`
}

// A linked worktree has a .git file naming its gitdir; the registry lives in that gitdir's commondir.
const commonDir = async ($: EngineInterface, top: string): Promise<string> => {
  const dotGit = `${top}/.git`
  let text: string
  try {
    text = await $.fs.read(dotGit)
  } catch {
    return dotGit
  }
  const gitdir = /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim()
  if (gitdir === undefined) return dotGit
  const absGitdir = resolveFrom(top, gitdir)
  const link = `${absGitdir}/commondir`
  if (!(await $.fs.exists(link))) return absGitdir
  return resolveFrom(absGitdir, (await $.fs.read(link)).trim())
}

const readGoals = async ($: EngineInterface, root: string): Promise<GoalFile[]> => {
  const repo = await $.session.repo()
  const dir = `${await commonDir($, repo?.root ?? root)}/${GOALS_DIR}`
  if (!(await $.fs.exists(dir))) return []
  const entries = (await $.fs.list(dir)).filter(one => one.kind === 'file' && one.name.endsWith('.json'))
  return Promise.all(
    entries.map(async one => ({ text: await $.fs.read(`${dir}/${one.name}`), mtimeMs: one.mtimeMs })),
  )
}

const readSnapshot = async ($: EngineInterface, startedAt: number): Promise<Snapshot> => {
  const root = await $.session.root()
  const [markers, isOn, files, sessionId] = await Promise.all([
    Promise.all(HARNESS_MARKERS.map(marker => $.fs.exists(`${root}/${marker}`))),
    $.fs.exists(`${root}/${AUTONOMY_FLAG}`),
    readGoals($, root),
    $.session.id(),
  ])
  const hasHarness = markers.some(Boolean)
  const picked = pickGoal(files, sessionId)
  if (picked === null) return { hasHarness, isOn, goal: null, isGoalFresh: false }
  return { hasHarness, isOn, goal: picked.goal, isGoalFresh: picked.mtimeMs >= startedAt }
}

const refreshOnce = async ($: EngineInterface): Promise<Snapshot | null> => {
  try {
    const next = await readSnapshot($, await read($, startedAtAtom))
    const prev = await read($, snapshotAtom)
    await update($, snapshotAtom, () => next)
    if (prev !== null) toastsFor(prev, next).forEach(text => $.ui.toast(text))
    return next
  } catch (error) {
    $.ui.log(`autonomy-status: refresh failed: ${String(error)}`, { to: 'debug' })
    return null
  }
}

let running: Promise<Snapshot | null> | undefined

const refresh = ($: EngineInterface): Promise<Snapshot | null> => {
  running ??= refreshOnce($).finally(() => {
    running = undefined
  })
  return running
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, startedAtAtom, started => started || now)
    await $.command.register({
      name: COMMAND,
      description: 'Show the autonomous-mode and goal status',
    })
    await refresh($)
    $.clock.every(POLL_MS, () => void refresh($))

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    void refresh($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    void refresh($)

    return ran
  })

  on('command.run', { command: COMMAND }, async $ => {
    const snapshot = await refresh($)

    return { text: snapshot === null ? 'Autonomy status unavailable.' : summary(snapshot) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snapshot = await read($, snapshotAtom)
    if (e.props.hasSurvey || snapshot === null || !isBandVisible(snapshot)) return next(e)

    const table = $.ui.resolve(e)
    const { Box } = table

    return (
      <Box flexDirection="column">
        <Box>{modeView(table, snapshot)}</Box>
        {goalHeaderView(table, snapshot)}
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const snapshot = await read($, snapshotAtom)
    const engineHint = await next(e)
    if (snapshot === null || shownGoal(snapshot) === null) return engineHint

    const table = $.ui.resolve(e)
    const { Box } = table

    return (
      <Box flexDirection="column">
        {countersView(table, snapshot)}
        {engineHint}
        {statusView(table, snapshot)}
      </Box>
    )
  })
}
