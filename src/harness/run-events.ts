import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeSync
} from 'node:fs'
import { createReadStream } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'

export interface RunEventWriter {
  append(type: string, payload: object): void
  close(): Promise<void>
}

const commandsByWriter = new WeakMap<RunEventWriter, string[]>()

export function observedCommands(writer: RunEventWriter): readonly string[] {
  return commandsByWriter.get(writer) ?? []
}

export function createEventWriter(eventsPath: string): RunEventWriter {
  mkdirSync(dirname(eventsPath), { recursive: true })
  const fd = openSync(eventsPath, 'a')
  let closed = false
  const commands: string[] = []
  const writer: RunEventWriter = {
    append(type, payload) {
      if (closed) throw new Error('Cannot append to a closed run-event writer')
      if (type === 'agent:event') {
        const event = 'event' in payload
          ? (payload as { event?: unknown }).event
          : undefined
        if (typeof event === 'object' && event !== null && 'kind' in event && 'command' in event) {
          const candidate = event as { kind?: unknown, command?: unknown }
          if (candidate.kind === 'command' && typeof candidate.command === 'string') {
            commands.push(candidate.command)
          }
        }
      }
      const line = `${JSON.stringify({ ...payload, ts: new Date().toISOString(), type })}\n`
      writeSync(fd, line)
      fsyncSync(fd)
    },
    async close() {
      if (closed) return
      fsyncSync(fd)
      closeSync(fd)
      closed = true
    }
  }
  commandsByWriter.set(writer, commands)
  return writer
}

export async function* readEvents(
  eventsPath: string
): AsyncIterable<{ ts: string, type: string } & Record<string, unknown>> {
  const input = createReadStream(eventsPath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let corrupt = 0
  for await (const line of lines) {
    if (line.trim() === '') continue
    try {
      const value = JSON.parse(line) as unknown
      if (
        typeof value !== 'object'
        || value === null
        || Array.isArray(value)
        || typeof (value as Record<string, unknown>).ts !== 'string'
        || typeof (value as Record<string, unknown>).type !== 'string'
      ) {
        corrupt += 1
        continue
      }
      yield value as { ts: string, type: string } & Record<string, unknown>
    } catch {
      corrupt += 1
    }
  }
  if (corrupt > 0) {
    process.emitWarning(`Skipped ${corrupt} corrupt run-event line${corrupt === 1 ? '' : 's'} in ${eventsPath}`)
  }
}
