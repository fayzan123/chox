import type { SubstrateStore } from './store.js'

export interface SourceFileStat {
  mtime: number
  size: number
}

export function needsScan(
  store: SubstrateStore,
  sourceId: string,
  ref: string,
  stat: SourceFileStat
): boolean {
  const watermark = store.getWatermark(sourceId, ref)
  return !watermark || watermark.mtime !== stat.mtime || watermark.size !== stat.size
}

export function advanceWatermark(
  store: SubstrateStore,
  sourceId: string,
  ref: string,
  stat: SourceFileStat
): void {
  store.upsertWatermark({ sourceId, fileRef: ref, mtime: stat.mtime, size: stat.size })
}
