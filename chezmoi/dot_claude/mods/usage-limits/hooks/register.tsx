import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-limits', key: 'limits' } as const, [])
const now = atom({ plugin: 'usage-limits', key: 'now' } as const, 0)

// `seven_day` is the account-wide weekly window. Per-model weekly windows
// (e.g. Fable) are expected as `seven_day_<model>`; anything else is ignored.
const WEEKLY = /^seven_day(?:_(.+))?$/
const BAR_CELLS = 20

const label = (kind: string) => {
  const model = WEEKLY.exec(kind)?.[1]
  return model ? model.charAt(0).toUpperCase() + model.slice(1) : 'Weekly'
}

const heading = (l: Limit) => `${label(l.kind)} (${l.percentUsed}%)`

const weekly = (all: Limit[]) =>
  all
    .filter(l => WEEKLY.test(l.kind))
    .sort((a, b) => (a.kind === 'seven_day' ? -1 : b.kind === 'seven_day' ? 1 : a.kind.localeCompare(b.kind)))

const countdown = (resetsAt: string | undefined, at: number) => {
  if (!resetsAt) return undefined
  const mins = Math.max(0, Math.round((Date.parse(resetsAt) - at) / 60_000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

const bar = (percent: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * BAR_CELLS)
  return { filled: '█'.repeat(filled), empty: '░'.repeat(BAR_CELLS - filled) }
}

// A titled rule across the band, so it reads as part of the prompt, not the transcript.
const rule = (columns: number) => {
  const title = '─ usage '
  return title + '─'.repeat(Math.max(0, columns - title.length))
}

const tone = (percent: number) => (percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : 'green')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // 0.1.0 drew this in the status line; the band replaces it.
    $.ui.status(undefined)
    await $.command.register({
      name: 'usage-limits',
      description: 'Show every rate-limit window the API reported',
    })
    const { rateLimits } = await $.session.usage()
    await update($, limits, () => rateLimits)
    const at = await $.clock.now()
    await update($, now, () => at)
    // Keeps the countdown moving between measurements.
    $.clock.every(30_000, () => void $.clock.now().then(at => update($, now, () => at)))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => e.rateLimits)
      const at = await $.clock.now()
      await update($, now, () => at)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rows = weekly(await read($, limits))
    if (e.props.hasSurvey || rows.length === 0) {
      return next(e)
    }

    const at = await read($, now)
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(...rows.map(l => heading(l).length))

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate">{rule(e.props.bodyColumns)}</Text>
        {rows.map((l: Limit) => {
          const { filled, empty } = bar(l.percentUsed)
          const resets = countdown(l.resetsAt, at)
          return (
            <Box key={l.kind} gap={1}>
              <Text bold>{heading(l).padEnd(width)}</Text>
              <Text>
                <Text color={tone(l.percentUsed)}>{filled}</Text>
                <Text dimColor>{empty}</Text>
              </Text>
              {resets ? <Text dimColor>resets in {resets}</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
  })

  on('command.run', { command: 'usage-limits' }, async $ => {
    const { rateLimits } = await $.session.usage()
    if (rateLimits.length === 0) {
      return { text: 'No rate-limit windows reported yet (send a prompt first, or not on a subscription).' }
    }
    const at = await $.clock.now()
    return {
      text: rateLimits
        .map(l => `${l.kind}: ${l.percentUsed}% used, resets ${l.resetsAt ?? '?'} (${countdown(l.resetsAt, at) ?? '?'})`)
        .join('\n'),
    }
  })
}
