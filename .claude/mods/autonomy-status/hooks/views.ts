import type { EngineInterface, RenderElement } from 'claude-code'

import type { Goal, Snapshot } from '../types'
import { PALETTE, clip, shownGoal } from './model'

export type Constructors = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text'>

export const modeView = ({ Text }: Constructors, snapshot: Snapshot): RenderElement =>
  Text({
    backgroundColor: snapshot.isOn ? PALETTE.accent : PALETTE.muted,
    color: PALETTE.onAccent,
    bold: true,
    children: snapshot.isOn ? ' ● AUTONOMOUS ' : ' ○ manual ',
  })

const statusColor = (goal: Goal): string =>
  goal.status === 'done'
    ? PALETTE.done
    : goal.status === 'escalated'
      ? PALETTE.escalated
      : PALETTE.accent

export const goalHeaderView = ({ Box, Text }: Constructors, snapshot: Snapshot): RenderElement | null => {
  const goal = shownGoal(snapshot)
  if (goal === null) return null
  const head = [
    goal.goal !== '' ? Text({ children: clip(goal.goal) }) : null,
    goal.pr !== null ? Text({ color: PALETTE.accent, children: ` PR #${goal.pr}` }) : null,
  ]
  return Box({ children: Text({ children: head }) })
}

export const countersView = ({ Box, Text }: Constructors, snapshot: Snapshot): RenderElement | null => {
  const goal = shownGoal(snapshot)
  if (goal === null) return null
  return Box({
    children: Text({
      color: PALETTE.muted,
      children: `fix ${goal.fixIterations}/${goal.maxFixIterations} · stop blocks ${goal.stopBlocks}`,
    }),
  })
}

export const statusView = ({ Box, Text }: Constructors, snapshot: Snapshot): RenderElement | null => {
  const goal = shownGoal(snapshot)
  if (goal === null || goal.status === 'active') return null
  const reason = goal.status === 'escalated' && goal.reason !== '' ? `: ${goal.reason}` : ''
  return Box({
    children: Text({ color: statusColor(goal), bold: true, wrap: 'wrap', children: `${goal.status}${reason}` }),
  })
}
