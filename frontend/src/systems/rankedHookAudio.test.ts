import { describe, expect, it } from 'vitest';

import type { RankedWasmRuntimeSnapshot } from '../game/rankedWasmRuntime';
import { deriveRankedHookAudioEvents } from './rankedHookAudio';

function createSnapshot(
  overrides: Partial<RankedWasmRuntimeSnapshot>,
): RankedWasmRuntimeSnapshot {
  return {
    logicTick: 0,
    hookState: 'swinging',
    hookAngleDeg: 80,
    hookLength: 0,
    caughtEntityIndex: null,
    diamondsCaught: 0,
    lastDiamondTick: 0,
    spawnCursor: 0,
    entities: [],
    ...overrides,
  };
}

describe('deriveRankedHookAudioEvents', () => {
  it('matches the authoritative ranked happy path audio sequence', () => {
    const swinging = createSnapshot({
      logicTick: 10,
      hookState: 'swinging',
    });
    const extending = createSnapshot({
      logicTick: 11,
      hookState: 'extending',
      hookLength: 8,
    });
    const returningLoaded = createSnapshot({
      logicTick: 12,
      hookState: 'returningLoaded',
      hookLength: 36,
      caughtEntityIndex: 0,
      diamondsCaught: 0,
    });
    const resolved = createSnapshot({
      logicTick: 18,
      hookState: 'swinging',
      hookLength: 0,
      caughtEntityIndex: null,
      diamondsCaught: 1,
      lastDiamondTick: 18,
    });

    expect(
      deriveRankedHookAudioEvents({
        previous: swinging,
        next: extending,
        enteringCaughtEntity: null,
        resolvingCaughtEntity: null,
      }),
    ).toEqual(['grabStart']);

    expect(
      deriveRankedHookAudioEvents({
        previous: extending,
        next: returningLoaded,
        enteringCaughtEntity: {
          type: 'Diamond',
          bonusTier: 'high',
          rewardKind: 'money',
        },
        resolvingCaughtEntity: null,
      }),
    ).toEqual(['highValue']);

    expect(
      deriveRankedHookAudioEvents({
        previous: returningLoaded,
        next: resolved,
        enteringCaughtEntity: null,
        resolvingCaughtEntity: {
          type: 'Diamond',
          bonusTier: 'high',
          rewardKind: 'money',
        },
      }),
    ).toEqual(['money', 'hookReset']);
  });

  it('preserves explosive hit audio before the value cue', () => {
    const previous = createSnapshot({
      hookState: 'extending',
      logicTick: 42,
    });
    const next = createSnapshot({
      hookState: 'returningLoaded',
      logicTick: 43,
      caughtEntityIndex: 0,
    });

    expect(
      deriveRankedHookAudioEvents({
        previous,
        next,
        enteringCaughtEntity: {
          type: 'TNT',
          bonusTier: 'low',
          rewardKind: 'money',
        },
        resolvingCaughtEntity: null,
      }),
    ).toEqual(['explosive', 'lowValue']);
  });

  it('emits a plain hook reset when the hook comes back empty', () => {
    const previous = createSnapshot({
      hookState: 'returningEmpty',
      logicTick: 50,
      hookLength: 4,
    });
    const next = createSnapshot({
      hookState: 'swinging',
      logicTick: 51,
      hookLength: 0,
    });

    expect(
      deriveRankedHookAudioEvents({
        previous,
        next,
        enteringCaughtEntity: null,
        resolvingCaughtEntity: null,
      }),
    ).toEqual(['hookReset']);
  });
});
