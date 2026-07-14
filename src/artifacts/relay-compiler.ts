import { join } from 'node:path'

import { ChoxUsageError } from '../errors.js'
import type { Autonomy, Interaction } from './ir.js'
import type { LoadedRelay } from './relay-loader.js'

export interface CompiledHop {
  index: number
  runtime: string
  role: string
  autonomy: Autonomy
  prompt: string
  produces: string[]
  gated: boolean
  interaction: Interaction
  model?: string
}

export interface ExecutionPlan {
  slug: string
  hops: CompiledHop[]
}

const artifactPrefix = '.chox-run/'

function artifactPath(name: string): string {
  return `${artifactPrefix}${name}`
}

export function relayConsumesTask(loaded: LoadedRelay): boolean {
  return loaded.relay.hops.some((hop) => (
    loaded.templates.get(hop.promptTemplate)?.includes('{{task}}') ?? false
  ))
}

export function compileRelay(
  loaded: LoadedRelay,
  opts: { task?: string } = {}
): ExecutionPlan {
  const consumesTask = relayConsumesTask(loaded)
  if (consumesTask && opts.task === undefined) {
    throw new ChoxUsageError(
      `Relay ${JSON.stringify(loaded.relay.slug)} requires a task. Pass --task <text> or --task-file <path>.`
    )
  }
  if (!consumesTask && opts.task !== undefined) {
    const template = loaded.relay.hops[0]?.promptTemplate
    const path = template ? join(loaded.dir, template) : loaded.dir
    throw new ChoxUsageError(
      `Relay ${JSON.stringify(loaded.relay.slug)} does not consume task input. Add {{task}} to its template at ${path}, or run it without --task/--task-file.`
    )
  }

  const produced = new Set<string>()
  const claimed = new Map<string, number>()
  const problems: string[] = []
  const hops: CompiledHop[] = []

  for (const [index, hop] of loaded.relay.hops.entries()) {
    const names = [...hop.produces]
    if (hop.autonomy === 'challenge' && !names.includes('challenge-notes.md')) {
      names.push('challenge-notes.md')
    }

    for (const name of names) {
      const earlier = claimed.get(name)
      const reusableChallengeNotes = name === 'challenge-notes.md' && hop.autonomy === 'challenge'
      if (earlier !== undefined && !reusableChallengeNotes) {
        problems.push(`hop ${index} produces duplicate artifact ${JSON.stringify(name)} already produced by hop ${earlier}`)
      } else if (earlier === undefined) {
        claimed.set(name, index)
      }
    }

    const template = loaded.templates.get(hop.promptTemplate)
    if (template === undefined) {
      problems.push(`hop ${index} template ${JSON.stringify(hop.promptTemplate)} was not loaded`)
      continue
    }

    const prompt = template.replace(/{{([^{}]+)}}/g, (placeholder, body: string) => {
      if (body === 'task') return opts.task ?? placeholder
      if (body === 'produces') return names.map(artifactPath).join(', ')
      if (body === 'repo') return loaded.repoRoot
      if (body.startsWith('artifact:')) {
        const name = body.slice('artifact:'.length)
        if (!produced.has(name)) {
          problems.push(`hop ${index} references artifact ${JSON.stringify(name)} before an earlier hop produces it`)
        }
        return artifactPath(name)
      }
      problems.push(`hop ${index} contains unknown placeholder ${JSON.stringify(placeholder)}`)
      return placeholder
    })

    hops.push({
      index,
      runtime: hop.runtime,
      role: hop.role,
      autonomy: hop.autonomy,
      prompt,
      produces: names.map(artifactPath),
      gated: loaded.relay.gates === 'all-boundaries',
      interaction: hop.interaction ?? 'interactive',
      ...(hop.model !== undefined ? { model: hop.model } : {})
    })
    for (const name of names) produced.add(name)
  }

  if (problems.length > 0) {
    throw new ChoxUsageError(`Could not compile relay ${JSON.stringify(loaded.relay.slug)}:\n${problems.map((problem) => `- ${problem}`).join('\n')}`)
  }
  return { slug: loaded.relay.slug, hops }
}

export function renderPlan(plan: ExecutionPlan): string {
  const lines = [
    `Chox dry run: ${plan.slug}`,
    'No processes will be spawned.',
    ''
  ]
  for (const hop of plan.hops) {
    lines.push(
      `Hop ${hop.index + 1}: ${hop.role}`,
      `  Runtime: ${hop.runtime}`,
      `  Interaction: ${hop.interaction}`,
      `  Model: ${hop.model ?? 'CLI default'}`,
      `  Autonomy: ${hop.autonomy}`,
      `  Produces: ${hop.produces.length > 0 ? hop.produces.join(', ') : '(none)'}`,
      `  Gate follows: ${hop.gated ? 'yes' : 'no'}`,
      '  Prompt:',
      hop.prompt,
      ''
    )
  }
  return `${lines.join('\n').trimEnd()}\n`
}
