import { test, expect, mock } from 'claude-code/testing'

const LIMITS = [
  { kind: 'seven_day', percentUsed: 42, resetsAt: '2026-10-08T00:00:00Z' },
  { kind: 'seven_day_fable', percentUsed: 91 },
  { kind: 'five_hour', percentUsed: 10 },
]

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as const

test('bars draw in the band above the prompt', async ($, on) => {
  on('session.measure', async (_$, e) => e as never)
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00Z') })
  await $.session.measure({ changed: ['rateLimits'], rateLimits: LIMITS } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-limits', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /^Weekly \(42%\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Fable \(91%\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /five_hour/i })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^─ usage ─+$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /resets in 3d 0h/ })).toBeDefined()
    await ui.unmount()
  }
})
