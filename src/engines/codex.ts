import {
  addUsage,
  parseEngineJson,
  runEngineProcess,
  type AnalysisEngine,
  type EngineCreateOpts,
  type EngineStats,
  type EngineUsage
} from './engine.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function token(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function createCodexEngine(
  env: NodeJS.ProcessEnv = process.env,
  opts: EngineCreateOpts = {}
): AnalysisEngine {
  let calls = 0
  const usage: EngineUsage = {}
  const model = opts.model?.trim() || undefined
  return {
    id: 'codex',
    ...(model ? { model } : {}),
    async analyze(prompt, opts = {}) {
      calls += 1
      const result = await runEngineProcess({
        binary: 'codex',
        args: [
          '--sandbox', 'read-only', '--ask-for-approval', 'never',
          ...(model ? ['-c', `model=${model}`] : []),
          'exec', '--json', '-'
        ],
        env,
        cwd: process.cwd(),
        prompt,
        timeoutMs: opts.timeoutMs ?? 30_000
      })
      if (result.code !== 0) {
        throw new Error(`Codex analysis failed (exit ${result.code}): ${result.stderr.trim() || 'no detail'}`)
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
        const item = isRecord(value.item) ? value.item : undefined
        if (value.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') {
          messages.push(item.text)
        }
        if (value.type === 'turn.completed' || value.type === 'session.completed') {
          const reported = isRecord(value.usage) ? value.usage : undefined
          const inputTokens = token(reported?.input_tokens)
          const cachedInputTokens = token(reported?.cached_input_tokens)
          const outputTokens = token(reported?.output_tokens)
          const totalTokens = token(reported?.total_tokens)
          const next: EngineUsage = {}
          if (inputTokens !== undefined) next.inputTokens = inputTokens
          if (cachedInputTokens !== undefined) next.cachedInputTokens = cachedInputTokens
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
