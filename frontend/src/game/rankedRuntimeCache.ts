import type { RankedWasmRuntimeFinalized } from './rankedWasmRuntime';

let latestRankedRuntimeFinalized: RankedWasmRuntimeFinalized | null = null;

export function getLatestRankedRuntimeFinalized(): RankedWasmRuntimeFinalized | null {
  return latestRankedRuntimeFinalized ? { ...latestRankedRuntimeFinalized } : null;
}

export function setLatestRankedRuntimeFinalized(
  finalized: RankedWasmRuntimeFinalized | null,
): void {
  latestRankedRuntimeFinalized = finalized ? { ...finalized } : null;
}
