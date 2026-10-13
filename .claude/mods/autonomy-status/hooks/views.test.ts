import { expect, test } from 'claude-code/testing'

import type { Goal, Snapshot } from '../types'
import { countersView, goalHeaderView, modeView, statusView, type Constructors } from './views'

const fake = {
  Box: (props: Record<string, unknown>) => ({ type: 'Box', ...props }),
  Text: (props: Record<string, unknown>) => ({ type: 'Text', ...props }),
} as unknown as Constructors

const goal: Goal = {
  goal: 'ship relationship history',
  criteria: [],
  branch: 'feat/x',
  pr: '42',
  headSha: 'abc',
  fixIterations: 1,
  maxFixIterations: 30,
  stopBlocks: 0,
  totalBlocks: 0,
  status: 'escalated',
  reason: 'CI red on main',
}

const snapshot = (over: Partial<Snapshot>): Snapshot => ({
  hasHarness: true,
  isOn: true,
  goal,
  isGoalFresh: true,
  ...over,
})

test('mode view shows only the mode indicator', () => {
  const drawn = JSON.stringify(modeView(fake, snapshot({})))
  expect(drawn).toContain('AUTONOMOUS')
  for (const hidden of ['ship relationship', 'PR #42', 'CI red', 'fix 1/30']) {
    expect(drawn).not.toContain(hidden)
  }
})

test('header view has goal and PR only', () => {
  const drawn = JSON.stringify(goalHeaderView(fake, snapshot({})))
  for (const shown of ['ship relationship', 'PR #42']) expect(drawn).toContain(shown)
  for (const hidden of ['CI red', 'fix 1/30', 'stop blocks', 'AUTONOMOUS']) expect(drawn).not.toContain(hidden)
})

test('counters view has iterations and blocks only', () => {
  const drawn = JSON.stringify(countersView(fake, snapshot({})))
  for (const shown of ['fix 1/30', 'stop blocks 0']) expect(drawn).toContain(shown)
  expect(drawn).not.toContain('ship relationship')
})

test('status view shows escalation reason', () => {
  expect(JSON.stringify(statusView(fake, snapshot({})))).toContain('escalated: CI red on main')
})

test('status view is empty while active', () => {
  expect(statusView(fake, snapshot({ goal: { ...goal, status: 'active' } }))).toBeNull()
})

test('goal views are empty without a goal', () => {
  const none = snapshot({ goal: null })
  expect(goalHeaderView(fake, none)).toBeNull()
  expect(countersView(fake, none)).toBeNull()
  expect(statusView(fake, none)).toBeNull()
})
