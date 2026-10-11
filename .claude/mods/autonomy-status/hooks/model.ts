import type { Goal, GoalStatus, Snapshot } from '../types'

export const PALETTE = {
  accent: '#4c9df3',
  onAccent: '#141414',
  done: '#a3be8c',
  escalated: '#bf616a',
  muted: '#828282',
} as const

export const HARNESS_MARKERS = ['.claude/agent-harness.json', '.claude/state'] as const
export const AUTONOMY_FLAG = '.claude/state/autonomy.on'
export const GOAL_FILE = '.claude/state/goal.json'

const GOAL_CLIP = 60
const STATUSES: readonly GoalStatus[] = ['active', 'escalated', 'done']

const asCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

export const clip = (text: string, max: number = GOAL_CLIP): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

export const parseGoal = (text: string): Goal | null => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const fields = raw as Record<string, unknown>
  const status = STATUSES.find(one => one === fields.status)
  if (status === undefined) return null
  const pr = fields.pr
  return {
    goal: asText(fields.goal),
    criteria: Array.isArray(fields.criteria) ? fields.criteria.map(asText) : [],
    branch: asText(fields.branch),
    pr: typeof pr === 'number' || (typeof pr === 'string' && pr !== '') ? String(pr) : null,
    headSha: asText(fields.head_sha),
    fixIterations: asCount(fields.fix_iterations),
    maxFixIterations: asCount(fields.max_fix_iterations),
    stopBlocks: asCount(fields.stop_blocks),
    totalBlocks: asCount(fields.total_blocks),
    status,
    reason: asText(fields.reason),
  }
}

export const shownGoal = (s: Snapshot): Goal | null =>
  s.goal !== null && (s.goal.status !== 'done' || s.isGoalFresh) ? s.goal : null

export const isBandVisible = (s: Snapshot): boolean => s.isOn || shownGoal(s) !== null

const prLabel = (goal: Goal): string => (goal.pr === null ? '' : ` #${goal.pr}`)

export const statusLine = (s: Snapshot): string | undefined => {
  const goal = shownGoal(s)
  if (!s.hasHarness && !s.isOn && goal === null) return undefined
  const parts = [s.isOn ? '● AUTO' : '○ manual']
  if (goal !== null) {
    parts.push(`${goal.status === 'active' ? 'ship' : goal.status}${prLabel(goal)}`)
    parts.push(`fix ${goal.fixIterations}/${goal.maxFixIterations}`)
  }
  return parts.join(' · ')
}

export const summary = (s: Snapshot): string => {
  if (!s.hasHarness && !s.isOn && s.goal === null) {
    return 'No autonomy state in this project.'
  }
  const lines = [`Autonomy: ${s.isOn ? 'ON' : 'off'}`]
  const goal = s.goal
  if (goal === null) return [...lines, 'Goal: none'].join('\n')
  lines.push(
    `Goal: ${goal.goal}`,
    `Status: ${goal.status}${goal.reason === '' ? '' : ` (${goal.reason})`}`,
    `Branch: ${goal.branch === '' ? '-' : goal.branch}`,
    `PR: ${goal.pr === null ? '-' : `#${goal.pr}`}`,
    `Head: ${goal.headSha === '' ? '-' : goal.headSha}`,
    `Fix iterations: ${goal.fixIterations}/${goal.maxFixIterations}`,
    `Stop blocks: ${goal.stopBlocks} (total ${goal.totalBlocks})`,
  )
  if (goal.criteria.length > 0) {
    lines.push('Criteria:', ...goal.criteria.map(one => `  - ${one}`))
  }
  return lines.join('\n')
}

export const toastsFor = (prev: Snapshot, next: Snapshot): string[] => {
  const toasts: string[] = []
  if (prev.isOn !== next.isOn) toasts.push(`Autonomy ${next.isOn ? 'ON' : 'OFF'}`)
  const before = prev.goal?.status
  const goal = next.goal
  if (goal === null || before === goal.status) return toasts
  if (goal.status === 'escalated') toasts.push(`Ship escalated: ${goal.reason || 'no reason given'}`)
  if (goal.status === 'done') toasts.push(`Goal done: PR${prLabel(goal)} merged`)
  return toasts
}
