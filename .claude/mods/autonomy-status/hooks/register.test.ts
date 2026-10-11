import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/repo'
const HARNESS = `${ROOT}/.claude/agent-harness.json`
const FLAG = `${ROOT}/.claude/state/autonomy.on`
const GOAL = `${ROOT}/.claude/state/goal.json`
const SESSION_START = 1000

const goalJson = (over: Record<string, unknown>): string =>
  JSON.stringify({
    goal: 'ship the saw item',
    criteria: ['CI green', 'PR merged'],
    branch: 'fmflurry/saw',
    pr: 48,
    head_sha: 'abc1234',
    fix_iterations: 2,
    max_fix_iterations: 5,
    stop_blocks: 1,
    total_blocks: 3,
    status: 'active',
    reason: '',
    ...over,
  })

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
} as never

const setup = async ($: Engine, on: On, files: Record<string, string>, mtimeMs = SESSION_START + 500) => {
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  mock.clock(on, { now: SESSION_START })
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', (_$, e) => ({ value: e.path in files }))
  on('fs.read', (_$, e) => ({ value: files[e.path] ?? '' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs, isLink: false } }))
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined as never }))
  on('ui.render', () => ({ type: 'Text', children: ['engine default'] }))
  on('session.start', () => ({ cwd: ROOT }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  return { statuses, toasts }
}

const bandText = async ($: Engine): Promise<string | undefined> => {
  const ui = await $.ui.mount({
    plugin: 'autonomy-status',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND,
  })
  const found = await ui.find({ type: 'Text', text: /AUTONOMOUS|GOAL/ })
  const drawn = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return found === undefined ? undefined : drawn
}

const run = ($: Engine) =>
  $.command.run({
    command: 'autonomy-status',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

describe('autonomy-status', () => {
  test('ON with an active goal shows band, status line and summary', async ($, on) => {
    const { statuses } = await setup($, on, {
      [HARNESS]: '',
      [FLAG]: '',
      [GOAL]: goalJson({}),
    })

    const result = await run($)
    const band = await bandText($)

    expect(statuses.at(-1)).toBe('● AUTO · ship #48 · fix 2/5')
    expect(result.text).toContain('Autonomy: ON')
    expect(result.text).toContain('Fix iterations: 2/5')
    expect(band).toContain('AUTONOMOUS')
    expect(band).toContain('PR #48')
    expect(band).toContain('#4c9df3')
  })

  test('OFF with no goal shows manual and no band', async ($, on) => {
    const { statuses } = await setup($, on, { [HARNESS]: '' })

    await run($)

    expect(statuses.at(-1)).toBe('○ manual')
    expect(await bandText($)).toBeUndefined()
  })

  test('escalated goal draws the reason in red and toasts the transition', async ($, on) => {
    const files: Record<string, string> = { [HARNESS]: '', [FLAG]: '', [GOAL]: goalJson({}) }
    const { toasts } = await setup($, on, files)
    await run($)

    files[GOAL] = goalJson({ status: 'escalated', reason: 'fix budget exhausted' })
    await run($)
    const band = await bandText($)

    expect(toasts).toContain('Ship escalated: fix budget exhausted')
    expect(band).toContain('escalated: fix budget exhausted')
    expect(band).toContain('#bf616a')
  })

  test('done goal toasts the merge and autonomy toggle toasts on/off', async ($, on) => {
    const files: Record<string, string> = { [HARNESS]: '', [FLAG]: '', [GOAL]: goalJson({}) }
    const { toasts } = await setup($, on, files)
    await run($)

    files[GOAL] = goalJson({ status: 'done' })
    delete files[FLAG]
    await run($)

    expect(toasts).toContain('Goal done: PR #48 merged')
    expect(toasts).toContain('Autonomy OFF')
    expect(await bandText($)).toContain('#a3be8c')
  })

  test('a done goal from before the session stays hidden', async ($, on) => {
    await setup($, on, { [HARNESS]: '', [GOAL]: goalJson({ status: 'done' }) }, SESSION_START - 500)

    await run($)

    expect(await bandText($)).toBeUndefined()
  })

  test('a non-harness repo shows nothing', async ($, on) => {
    const { statuses, toasts } = await setup($, on, {})

    const result = await run($)

    expect(statuses.at(-1)).toBeUndefined()
    expect(toasts).toHaveLength(0)
    expect(result.text).toBe('No autonomy state in this project.')
    expect(await bandText($)).toBeUndefined()
  })
})
