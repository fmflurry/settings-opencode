import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'
import {
  AUTONOMY_FLAG,
  GOAL_FILE,
  HARNESS_MARKERS,
  isBandVisible,
  parseGoal,
  shownGoal,
  summary,
  toastsFor,
} from './model'
import { countersView, goalHeaderView, modeView, statusView } from './views'

const POLL_MS = 3000
const COMMAND = 'autonomy-status'

const snapshotAtom = atom({ plugin: 'autonomy-status', key: 'snapshot' } as const, null)
const startedAtAtom = atom({ plugin: 'autonomy-status', key: 'startedAt' } as const, 0)

const readSnapshot = async ($: EngineInterface, startedAt: number): Promise<Snapshot> => {
  const root = await $.session.root()
  const goalPath = `${root}/${GOAL_FILE}`
  const [markers, isOn, hasGoal] = await Promise.all([
    Promise.all(HARNESS_MARKERS.map(marker => $.fs.exists(`${root}/${marker}`))),
    $.fs.exists(`${root}/${AUTONOMY_FLAG}`),
    $.fs.exists(goalPath),
  ])
  const hasHarness = markers.some(Boolean)
  if (!hasGoal) return { hasHarness, isOn, goal: null, isGoalFresh: false }
  const [text, stat] = await Promise.all([$.fs.read(goalPath), $.fs.stat(goalPath)])
  return { hasHarness, isOn, goal: parseGoal(text), isGoalFresh: stat.mtimeMs >= startedAt }
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
