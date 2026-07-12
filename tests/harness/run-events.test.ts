import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { createEventWriter, readEvents } from '../../src/harness/run-events.js'
import { cleanupTempDirs, makeTempDir } from '../helpers/temp.js'

afterEach(cleanupTempDirs)

test('events append and read back as JSONL, including unknown future types', async () => {
  const root = await makeTempDir()
  const path = join(root, 'run', 'events.jsonl')
  const writer = createEventWriter(path)
  writer.append('run:start', { slug: 'demo' })
  writer.append('future:event', { value: 42 })
  await writer.close()

  const events = []
  for await (const event of readEvents(path)) events.push(event)
  expect(events.map(({ type }) => type)).toEqual(['run:start', 'future:event'])
  expect(events[1]).toMatchObject({ value: 42 })
})

test('a corrupt trailing line is skipped with a diagnostic instead of throwing', async () => {
  const root = await makeTempDir()
  const path = join(root, 'events.jsonl')
  const writer = createEventWriter(path)
  writer.append('hop:start', { hop: 0 })
  await writer.close()
  await appendFile(path, '{"partial":')
  const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined)

  const events = []
  for await (const event of readEvents(path)) events.push(event)
  expect(events).toHaveLength(1)
  expect(warning).toHaveBeenCalledWith(expect.stringMatching(/1 corrupt/))
  warning.mockRestore()
})
