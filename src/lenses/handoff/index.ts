import type { AnalysisEngine } from '../../engines/engine.js'
import type { SubstrateStore } from '../../substrate/store.js'
import type { Candidate, Finding, Lens, LensOpts } from '../lens.js'
import { confirmHandoffCandidates } from './confirm.js'
import { scanHandoff } from './scan.js'

class HandoffLens implements Lens {
  readonly id = 'handoff'
  #store: SubstrateStore | undefined

  scan(store: SubstrateStore, opts: LensOpts): Promise<Candidate[]> {
    this.#store = store
    return scanHandoff(store, opts)
  }

  async confirm(candidates: Candidate[], engine: AnalysisEngine): Promise<Finding[]> {
    if (!this.#store) throw new Error('handoffLens.confirm requires scan() first')
    return (await confirmHandoffCandidates({
      store: this.#store,
      candidates,
      engine
    })).findings
  }
}

export const handoffLens: Lens = new HandoffLens()
export { confirmHandoffCandidates, scanHandoff }
