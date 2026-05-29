import { describe, expect, it } from 'vitest';

import {
  createRankedWasmRuntimeFacade,
  getRankedWasmAvailability,
  preloadRankedWasmRuntime,
} from './rankedWasmRuntime';
import { loadRankedChallengeSpec } from './rankedChallengeManifest';

describe('ranked wasm runtime facade', () => {
  it('gracefully reports missing wasm module in local development', async () => {
    const availability = await preloadRankedWasmRuntime();

    expect(availability.supported).toBe(false);
    expect(getRankedWasmAvailability().reason).toBe('module-missing');
  });

  it('falls back to null facade when wasm artifacts are unavailable', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        async json() {
          return (await import('../../public/ranked-challenge-manifest.json')).default;
        },
      }) as Response) as typeof fetch;

    const spec = await loadRankedChallengeSpec('diamond_rush_60', 1);
    const facade = await createRankedWasmRuntimeFacade(spec);

    expect(facade).toBeNull();
  });
});
