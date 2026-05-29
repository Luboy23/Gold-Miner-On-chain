import { beforeEach, describe, expect, it } from 'vitest';

import { gameState } from './gameState';
import { buildFreshCasualExperiencePayload } from './startCasualExperience';

describe('buildFreshCasualExperiencePayload', () => {
  beforeEach(() => {
    gameState.bootstrap();
    gameState.resetForMenu();
  });

  it('acknowledges experience mode and creates a fresh first-level casual run', () => {
    const payload = buildFreshCasualExperiencePayload();

    expect(gameState.snapshot.save.acknowledgedExperienceMode).toBe(true);
    expect(payload.mode).toBe('next-goal');
    expect(payload.run.mode).toBe('casual');
    expect(payload.run.levelGroup).toBe(1);
    expect(payload.run.levelId).toBe('L1');
    expect(payload.run.score).toBe(0);
    expect(payload.run.currentShopOffers).toBeNull();
    expect(gameState.snapshot.currentRun?.mode).toBe('casual');
    expect(gameState.snapshot.currentRun?.levelGroup).toBe(1);
  });

  it('replaces any existing run with a fresh casual experience run', () => {
    gameState.setCurrentRun({
      mode: 'casual',
      seed: 'old-seed',
      levelGroup: 4,
      levelId: 'L4',
      goal: 1900,
      score: 1200,
      scoreView: 1200,
      timeRemainingSec: 12,
      dynamiteCount: 2,
      caughtCount: 5,
      purchasedItems: ['dynamite'],
      temporaryBuffs: {
        strengthDrink: 1,
        luckyClover: 0,
        rockCollectorsBook: 0,
        gemPolish: 0,
      },
      currentShopOffers: [],
      status: 'playing',
      rankedContext: null,
      campaignContext: null,
    });

    const payload = buildFreshCasualExperiencePayload();

    expect(payload.run.levelGroup).toBe(1);
    expect(payload.run.score).toBe(0);
    expect(payload.run.purchasedItems).toEqual([]);
    expect(payload.run.temporaryBuffs).toEqual({
      strengthDrink: 0,
      luckyClover: 0,
      rockCollectorsBook: 0,
      gemPolish: 0,
    });
    expect(payload.run.seed).not.toBe('old-seed');
  });
});
