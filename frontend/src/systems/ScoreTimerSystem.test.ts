import { describe, expect, it } from 'vitest';

import { ScoreTimerSystem } from './ScoreTimerSystem';
import type { RunState } from '../game/types/index';

function makeRun(): RunState {
  return {
    mode: 'casual',
    seed: 'timer-test',
    levelGroup: 1,
    levelId: 'L1',
    goal: 500,
    score: 0,
    scoreView: 0,
    timeRemainingSec: 10,
    dynamiteCount: 0,
    caughtCount: 0,
    purchasedItems: [],
    temporaryBuffs: {
      strengthDrink: 0,
      luckyClover: 0,
      rockCollectorsBook: 0,
      gemPolish: 0,
    },
    currentShopOffers: null,
    status: 'playing',
    rankedContext: null,
    campaignContext: null,
  };
}

describe('ScoreTimerSystem.consumeElapsedTime', () => {
  it('reduces remaining time directly', () => {
    const system = new ScoreTimerSystem(makeRun());

    system.consumeElapsedTime(3.4);

    expect(system.snapshot.timeRemainingSec).toBeCloseTo(6.6, 5);
  });

  it('clamps remaining time to zero', () => {
    const system = new ScoreTimerSystem(makeRun());

    system.consumeElapsedTime(20);

    expect(system.snapshot.timeRemainingSec).toBe(0);
  });
});
