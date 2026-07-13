import {
  addUsage,
  parseEngineJson,
  runEngineProcess,
  type AnalysisEngine,
  type EngineStats,
  type EngineUsage
} from './engine.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function token(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function createClaudeEngine(env: NodeJS.ProcessEnv = process.env): AnalysisEngine {
  let calls = 0
  const usage: EngineUsage = {}
  return {
    id: 'claude',
    async analyze(prompt, opts = {}) {
      calls += 1
      const result = await runEngineProcess({
        binary: 'claude',
        args: ['-p', '--output-format', 'stream-json', '--verbose', '--tools', ''],
        env,
        cwd: process.cwd(),
        prompt,
        timeoutMs: opts.timeoutMs ?? 30_000
      })
      if (result.code !== 0) {
        throw new Error(`Claude analysis failed (exit ${result.code}): ${result.stderr.trim() || 'no detail'}`)
      }
      const messages: string[] = []
      for (const line of result.stdout.split(/\r?\n/)) {
        if (line.trim() === '') continue
        let value: unknown
        try {
          value = JSON.parse(line) as unknown
        } catch {
          continue
        }
        if (!isRecord(value)) continue
        if (value.type === 'result' && typeof value.result === 'string') messages.push(value.result)
        const message = isRecord(value.message) ? value.message : undefined
        if (Array.isArray(message?.content)) {
          for (const itemValue of message.content) {
            const item = isRecord(itemValue) ? itemValue : undefined
            if (item?.type === 'text' && typeof item.text === 'string') messages.push(item.text)
          }
        }
        if (value.type === 'result') {
          const reported = isRecord(value.usage) ? value.usage : undefined
          const cacheRead = token(reported?.cache_read_input_tokens)
          const cacheCreate = token(reported?.cache_creation_input_tokens)
          const inputTokens = token(reported?.input_tokens)
          const outputTokens = token(reported?.output_tokens)
          const totalTokens = token(reported?.total_tokens)
          const next: EngineUsage = {}
          if (inputTokens !== undefined) next.inputTokens = inputTokens
          if (cacheRead !== undefined || cacheCreate !== undefined) {
            next.cachedInputTokens = (cacheRead ?? 0) + (cacheCreate ?? 0)
          }
          if (outputTokens !== undefined) next.outputTokens = outputTokens
          if (totalTokens !== undefined) next.totalTokens = totalTokens
          addUsage(usage, next)
        }
      }
      return parseEngineJson(messages)
    },
    stats(): EngineStats {
      return { calls, usage: { ...usage } }
    }
  }
}
