export type GoalStatus = 'active' | 'escalated' | 'done'

export type Goal = {
  goal: string
  criteria: readonly string[]
  branch: string
  pr: string | null
  headSha: string
  fixIterations: number
  maxFixIterations: number
  stopBlocks: number
  totalBlocks: number
  status: GoalStatus
  reason: string
}

export type Snapshot = {
  hasHarness: boolean
  isOn: boolean
  goal: Goal | null
  isGoalFresh: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'autonomy-status': { snapshot: Snapshot | null; startedAt: number }
  }
}
